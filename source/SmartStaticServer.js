
import * as Http from 'http'
import {promises as Fs} from 'fs' // https://nodejs.org/dist/latest-v12.x/docs/api/fs.html#fs_fs_promises_api
import * as FsNorm from 'fs'
import * as Path from 'path'
import * as Readline from 'readline'
import * as Os from 'os'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const
  WebSocket = require('ws') // https://github.com/websockets/ws
  ,Mime = require('mime-types') // https://www.npmjs.com/package/mime-types
  ,Chokidar = require('chokidar') // for a better fs.watch

function getLocalIPs() {
  let IPs = []
  const ifaces = Os.networkInterfaces()
  for (let ifname of Object.keys(ifaces)) {
    for (let iface of ifaces[ifname]) {
      if ('IPv4' !== iface.family || iface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        break
      }
      IPs.push(iface.address)
    }
  }
  return IPs
}

async function fileToResponse(response, fileInfo) {
  /* ToDo:
  Cache smaller files
  Cache files used often
  Do not cache big files
    Or maybe if everything fits in the buffer
  Have a setting to set size of buffer used for caching
    Automatically choose what should be in the buffer based
    on trafic and size.
  */
  let fileSize = (await Fs.stat(fileInfo.path)).size // get file size
  //const fileBuffer = await Fs.readFile(fileInfo.path)
  response.setHeader('Content-Length', fileSize)//fileBuffer.length)
  response.setHeader('Content-Type', fileInfo.contentType)
  response.setHeader('eTag', numberToHex(fileInfo.dateModified))
  response.statusCode = 200 //response.writeHead(200)
  let readStream = FsNorm.createReadStream(fileInfo.path) // auto closes
  readStream.pipe(response)
  await new Promise((resolve, reject) => {
    readStream.on('close', resolve)
    readStream.on('error', reject)
  })
  //response.end(fileBuffer)
}

function numberToHex(number) {
  return number.toString(16)
}
function hexToNumber(etag) {
  return parseInt(etag, 16)
}

export class SmartStaticServer {// extends EventTarget {
  constructor({
    host = '0.0.0.0', // = listen at all addresses (no restrictions, use 127.0.0.1 instead to limit to the same computer)
    port = null, // will choose a free port (usually high number)
    wsHandler, 
    serve = [],
    closeOnUncaughtExeption = true,
    closeOnSigint = true,
    verbose = true, // emit messages when starting and stopping the server, etc
    debug = false, // emit debug messages
    indexFiles = ['index.html']
  } = {}) {
    this._fileMap = new Map()
    this._port = port
    this._host = host
    // this._refuseConnection = false
    this._serve = serve
    this._watchedPaths = []
    this._wsHandler = wsHandler
    this._closeOnSigint = closeOnSigint
    this._indexFiles = indexFiles
    this._openSockets = new Map()

    if (verbose) {
      this._log = console.log
    } else {
      this._log = () => {}
    }
    if (debug) {
      this._debug = console.log
    } else {
      this._debug = () => {}
    }

    if (closeOnUncaughtExeption) {
      process.on('uncaughtException', err => { // if program error happens (even syntax errors)
        this._log(`Error (uncaughtException): ${err}`)
        this.shutdown()
      })
      process.on('unhandledRejection', err => { // uncaught promise rejection
        this._log(`Error (unhandledRejection): ${err}`)
        this.shutdown()
      })
      // process.on('exit', (code) => {
      //   console.this._log(`Proccess stopped with code: ${code}`)
      // })
    }

    this._server = Http.createServer()
    this._server.on('connection', socket => { // TCP connection
      this._openSockets.set(socket, null) // keep track of open sockets
      socket.on('end', () => {
        this._openSockets.delete(socket) // remove them when they close
      })
    })
    this._server.on('request', this.requestHandler.bind(this))
    this._server.on('clientError', (err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    })
    this._server.on('error', e => {
      if (e.code === 'EADDRINUSE') {
        this._log('Address:port already in use!')
        this.shutdown()
      } else {
        throw e
      }
    })
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this._closeOnSigint) {
        this._rl = Readline.createInterface({
          input: process.stdin,
          output: process.stdout
        })
        this._rl.on('SIGINT', () => {
          this._log(`SIGINT received, terminating...`)
          this.shutdown()
        })
      }
  
      if (this._server.listening) { // already running
        resolve(this._server.address())
      } else {
        this._server.listen({
          host: this._host,
          port: this._port,
          //exclusive: true
        }, async () => {
          const ipAddresses = getLocalIPs()
          const listening = this._server.address()
          resolve(listening) // this does not terminate the function, but allows the promise to return the value already
          this._log('HTTP server started, listening at:', listening)
          switch (listening.address) {
            case '0.0.0.0':
              //ipAddresses.unshift('127.0.0.1')
              this._log('Warning: Public server reachable at ANY of these addresses', ipAddresses,
              'if not blocked by a firewall. Also reachable at your WAN address if port '+listening.port+' is open to the internet.')
            break
            case '127.0.0.1':
              ipAddresses.unshift('127.0.0.1')
              this._log('Local server only reachable at localhost/127.0.0.1 (only this computer can connect)')
            break
          }
          this._log('http://'+ipAddresses[0]+':'+this._server.address().port)
  
          if (typeof(this._wsHandler) == 'function') {
            this._wss = new WebSocket.Server({
              noServer: true,
              //perMessageDeflate: true
            })
            this._server.on('upgrade', (request, socket, head) => {
              this._wss.handleUpgrade(request, socket, head, (ws) => {
                this._wsHandler(ws)
                //wss.emit('connection', ws, request)
              })
            })
          }
      
          if (this._watchedPaths.length == 0) {
            for (let serve of this._serve) {
              if (serve.dir.startsWith('./')) serve.dir = serve.dir.substring(2, serve.dir.length)
              if (!serve.dir.endsWith('/')) serve.dir += '/'
              if (!serve.as.startsWith('/')) serve.as = '/'+serve.as
              if (!serve.as.endsWith('/')) serve.as += '/'
              let dirStat
              try {
                dirStat = await Fs.stat(serve.dir)
              } catch (e) {
                if (e.code == 'ENOENT') {
                  throw Error(serve.dir+' is not a directory!')
                }
                throw e
              }
              if (dirStat.isDirectory()) {
                let setFileInfo = (filePath, fileStat) => {
                  // let extractFrom = serve.dir.length
                  // if (serve.as.startsWith('/')) extractFrom -= 1
                  // if (serve.as.endsWith('/')) extractFrom -= 1
                  let extractFrom = filePath.indexOf(serve.dir) + serve.dir.length
                  let serverPath = serve.as + filePath.substring(extractFrom, filePath.length)
                  let fileInfo = {
                    path: filePath,
                    contentType: Mime.contentType(Path.extname(filePath)),
                    dateModified: fileStat.mtimeMs,
                  }
                  this._fileMap.set(serverPath, fileInfo)
                  this._debug(serverPath, fileInfo)
                  if (this._indexFiles.includes(Path.basename(serverPath))) {
                    serverPath = Path.dirname(serverPath)
                    if (!serverPath.endsWith('/')) serverPath += '/'
                    this._fileMap.set(serverPath, fileInfo)
                    this._debug(serverPath, fileInfo)
                  }
                }
                this._watchedPaths.push(
                  Chokidar.watch(serve.dir, {
                    alwaysStat: true
                  })
                  .on('add', setFileInfo) // file added
                  .on('change', setFileInfo) // file changed
                  .on('unlink', (filePath, fileStat) => { // file removed
                    let extractFrom = filePath.indexOf(serve.dir) + serve.dir.length
                    let serverPath = serve.as + filePath.substring(extractFrom, filePath.length)
                    this._fileMap.delete(serverPath)
                    if (this._indexFiles.includes(Path.basename(serverPath))) {
                      serverPath = Path.dirname(serverPath)
                      if (!serverPath.endsWith('/')) serverPath += '/'
                      if (this._fileMap.has(serverPath)) {
                        this._fileMap.delete(serverPath)
                      }
                    }
                  })
                )
              } else {
                throw Error(serve.dir+' is not a directory!')
              }
            }
          }
  
        })
      }
    })
  }
  
  shutdown() {
    // this._refuseConnection = true
    this._log("Server closing...")
    if (this.wss) {
      for(const client of wss.clients) { // tell clients to close
        client.close()
      }
      this.wss.close(() => {
        this._log("WebSocket server closed") // called when server really closed
      })
      setTimeout(() => { // force closing of sockets for clients who didn't respond
        for(const client of wss.clients) {
          if ([client.OPEN, client.CLOSING].includes(client.readyState)) {
            client.terminate()
          }
        }
      }, 2000)
    }
    if (this._server.listening) {
      for (const socket of this._openSockets) {
        socket.end()
        //socket.destroy()
      }
      this._server.close(() => {
        // this._refuseConnection = false
        this._log("HTTP server closed")
      })
    }
    for (let watchedPath of this._watchedPaths) {
      watchedPath.close()
    }
    this._watchedPaths = []
    if (this._closeOnSigint) {
      this._rl.close()
    }
  }

  async requestHandler(request, response) {
    // if (this._refuseConnection) {
    //   response.end() //close the response
    //   request.connection.end() //close the socket
    //   //request.connection.destroy() //close it really
    //   return
    // }
    const ip = request.socket.remoteAddress
    let urlPath
    try {
      if (request.method == 'GET') {
        const url = new URL(request.url, 'http:\\x')
        urlPath = decodeURI(url.pathname)
        if (this._fileMap.has(urlPath)) { // this is super safe, no path exploits can happen
          const fileInfo = this._fileMap.get(urlPath) // extract the fileinfo reference
          if ('if-none-match' in request.headers
              && request.headers['if-none-match'] == numberToHex(fileInfo.dateModified)) {
            response.statusCode = 304 //Not Modified
            response.end()
          } else { // if updated content needs to be pushed to server
            await fileToResponse(response, fileInfo)
          }
        } else { // 404 not found
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.statusCode = 404 //Not Found
          response.end('404 Not found: '+urlPath)
        }
      } else {
        response.statusCode = 405 //Method Not Allowed
        response.end()
      }
    } catch (e) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.statusCode = 500 //Internal Server Error
      response.end('500 Server error: '+e)
    }
    this._log(ip, response.statusCode, response.statusMessage, request.method, urlPath)
  }
  
}
