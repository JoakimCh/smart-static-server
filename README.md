# smart-static-server

A Node.js ES module to quicly bootstrap a static server 
with an optional WebSocket handler. With WebSockets a static sever
can actually replace a dynamic server. 😉

## Features
* Can serve multiple directories with selectable server paths.
* Allows callback for WebSocket connections.
* Does not resolve paths from URLs (no ../ trick possible).
* Recognizes index.html files (can be configured).
* Allows client to cache files (using eTag).
* Monitors served directories for changes (using Chokidar).
* Can start and stop server at will.
* Simple implementation (not much bloat).

## Example
```js
import {SmartStaticServer} from 'smart-static-server'

const server = new SmartStaticServer({
  host: 'localhost',
  port: 8080,
  wsHandler: wsHandler, 
  serve: [
    {dir: 'www', as: '/'}
  ]
})

server.start()
//server.shutdown()
```
## How to use

Install using NPM
```bash
npm install joakimch/smart-static-server#master
```
Import into your code
```js
import {SmartStaticServer} from 'smart-static-server'
// btw: this way of importing an ES module is not compatible with globally installed ES modules for some reason
```
Make sure that you use an updated version of Node.js with support for ES modules. Most likely you will need to run the script using the `--experimental-modules` flag. Like this:
```bash
node --experimental-modules my-script.js
```
Also make sure that there is a package.json in the same folder as the script (or any above it) including this field:
```json
{
  "type": "module"
}
```
If you also want to be able to use `require()` in the same script then you can implement it like this:
```js
// Implement the old require function
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
// Now you can use require() to require whatever
```

## Todo (maybe)
* DoS / DDoS protection (maybe as plugin?)
  * Different responses that could crash or confuse client
    * gzip bomb // https://blog.haschek.at/2017/how-to-defend-your-website-with-zip-bombs.html
    * random binary data
    * content larger than "content-length"
    * redirect client to cia.gov/i-am-an-evil-hacker
* Logging (selectable level)
  * One level is just to log strange requests
* Smart server caching (optional cache size)

## WARNING (please read)

### This is a one-man project put here mostly to serve myself, not the public. Hence there might be bugs, missing or incomplete features. And I might not care about "industry standards", your meanings or doing things in any other way than MY way.

### But I do believe that this project can be useful to others, so rest assured that I will not remove it. Feel free to use it and spread the word about it, but never expect anything from me!

If you want to contribute to the project you might be better off by forking it, I don't have much time or energy to manage an open source project. If you fixed a bug I will probably accept the pull request though.
