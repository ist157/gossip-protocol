Node.js is needed along with the modules net, util, fs, os, crypto, events. Many of the modules come installed with nodejs.

Usage:
```
./seed.js <host> <port>
./peer.js <host> <port>
```
The output filenames are of the format `output-<seed/peer>-host-port.txt`

`SIGINT` sends a peer node into the dead state. A second `SIGINT` kills the process the usual way.