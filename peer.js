#!/usr/bin/env node
require("util").inspect.defaultOptions.depth = null

let doubleLog = st => { // string
   console.log(st)
   require('fs').appendFileSync(outputFile, st + '\n')
}
let EventEmitter = require('events')
class EventEmitterWithLog extends EventEmitter {
   emitWithLog(eventName, ...args) { // https://nodejs.org/api/events.html#events_emitter_emit_eventname_args
      doubleLog(`global event "${eventName}" fired`)
      return super.emit(eventName, ...args)
   }
}
let globalEmitter = new EventEmitterWithLog()

let sleep = async t => new Promise(resolve => setTimeout(resolve, t*1000))

let hash = s => require('crypto').createHash('md5').update(s, 'utf8').digest('hex')
let messageList = new Set()
let alive = true
let livenessList

let serverHost = process.argv[2]
let serverPort = process.argv[3]
let outputFile = `output-peer-${serverHost}-${serverPort}.txt`
require('fs').openSync(outputFile, 'w') // initialize empty file

//////// initialize the server
let server = require('net').createServer().on('connection', socket => {
   socket.setEncoding('utf8')

   socket.on('data', message => {
      if (alive) {
         arr = message.split(':')
         if (arr[0] == 'Liveness Request') {
            doubleLog(`(${arr[1]}) liveness request received - ${message}`) // only the server ports are chosen by us and are significant
            livenessReplyMessage = `Liveness Reply:${arr[1]}:${arr[2]}:${serverHost}`
            doubleLog(`(${arr[1]}) liveness reply sent - ${livenessReplyMessage}`)
            socket.write(livenessReplyMessage)
         }
         else if (!(messageList.has(hash(message)))) { // gossip
            messageList.add(hash(message))
            doubleLog(`(${arr[0]}) gossip message received - ${message}`)
            globalEmitter.emit('new gossip message received', message)
         }
      }
   })
})
globalEmitter.on('begin', () => server.listen(serverPort, serverHost))
server.on('listening', () => globalEmitter.emitWithLog('server ready')) // just converting other objects' events to globalEmitter's events to make the job easy

////////// randomizer for picking up seeds and peers
let getRandom = (arr, n) => {
   len = arr.length
   taken = new Array(len)
   n = Math.min(n, arr.length)
   var result = new Array(n)
   while (n--) {
      let x = Math.floor(Math.random() * len)
      result[n] = arr[x in taken ? taken[x] : x];
      taken[x] = --len in taken ? taken[len] : len;
   }
   return result;
}

////////// get the seed details from the config
let fullSeedList = require('fs').readFileSync('config.csv', 'utf8')
   .split('\n')
   .map(x => x.split(','))
   .map(function(x) {
      return {
         host: x[0],
         port: x[1]
      }
   })
let seedList = getRandom(fullSeedList, Math.floor(fullSeedList.length/2)+1)

////////// seed connections
let fullPeerList = []
let receivedItemsFromSeeds = 0
let seedSocketList = []
let removeDuplicates = l => {
   let map = {}
   let newArray = []
   l.forEach(x => {
      if (!map[JSON.stringify(x)]) {
         map[JSON.stringify(x)] = true
         newArray.push(x)
      }
   })
   return newArray
}
let peerList = []
globalEmitter.on('received from all seeds', () => {
   peerList = getRandom(removeDuplicates(fullPeerList), 4)
   globalEmitter.emitWithLog('peerList filled')
})
globalEmitter.on('server ready', () => {
   seedList.forEach( (seedInfo, i) => {
      let clientSocket = require('net').connect(seedInfo.port, seedInfo.host)
      seedSocketList[i] = clientSocket
      clientSocket.setEncoding('utf8')
      clientSocket.on('connect', function() {
         clientSocket.write(`Registration:${serverHost}:${serverPort}`)
      })
      clientSocket.on('data', message => {
         fullPeerList = fullPeerList.concat(JSON.parse(message))
         receivedItemsFromSeeds++
         if (receivedItemsFromSeeds == seedList.length) globalEmitter.emitWithLog('received from all seeds')
      })
   })
})

//////// peer connections
globalEmitter.on('peerList filled', () => {
   livenessList = new Array(peerList.length).fill(0)
   peerList.forEach( (peerInfo, i) => {
      let clientSocket = require('net').connect(peerInfo.port, peerInfo.host)
      clientSocket.setEncoding('utf8')

      clientSocket.on('connect', async () => { // liveness request
         while (true && alive) {
            let timestamp = Date.now()
            if (livenessList[i] < -3) {
               seedSocketList.forEach( (socket, i) => { // dead node
                  let deadNodeMessage = `Dead Node:${peerInfo.host}:${peerInfo.port}:${timestamp}:${serverHost}`
                  socket.write(deadNodeMessage)
                  doubleLog(`(${timestamp}) dead node message sent to ${seedList[i].host},${seedList[i].port} - ${deadNodeMessage}`)
                  clientSocket.end()
               })
               break
            }
            livenessRequestMessage = `Liveness Request:${timestamp}:${serverHost}`
            clientSocket.write(livenessRequestMessage)
            livenessList[i] -= 1
            doubleLog(`(${timestamp}) liveness request sent to ${peerInfo.host},${peerInfo.port} - ${livenessRequestMessage} (${livenessList})`)
            await sleep(13)
         }
      })
      clientSocket.on('connect', async () => { // generate gossip message
         let messageID = 0
         while (messageID++ < 10 && alive) {
            let timestamp = Date.now()
            gossipMessage = `${timestamp}:${serverHost}:message_${messageID}`
            doubleLog(`(${timestamp}) gossip message sent to ${peerInfo.host},${peerInfo.port} - ${gossipMessage}`)
            clientSocket.write(gossipMessage)
            await sleep(5)
         }
      })
      clientSocket.on('data', message => { // liveness reply
         if (alive) {
            arr = message.split(':')
            if (arr[0] == "Liveness Reply") {
               livenessList[i] += 1
               console.log(`(${arr[1]}) liveness reply received from ${peerInfo.host},${peerInfo.port} - ${livenessRequestMessage} (${livenessList})`)
            }
         }
      })
      globalEmitter.on('new gossip message received', gossipMessage => { // relay gossip message
         if (alive) {
            doubleLog(`(${arr[0]}) gossip message relayed to ${peerInfo.host},${peerInfo.port} - ${gossipMessage}`)
            clientSocket.write(gossipMessage)
         }
      })
   })
})

// ctrl+c handler
process.once('SIGINT', () => {
   alive = false
   console.log('interrupt - the node is now dead')
   process.on('SIGINT', () => process.exit())
})

////// after all the listeners are in place, begin the actual process
globalEmitter.emit('begin')