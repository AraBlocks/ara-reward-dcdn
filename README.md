<img src="https://github.com/arablocks/ara-module-template/blob/master/ara.png" width="30" height="30" />  ara-reward-dcdn
====================

[![Build Status](https://travis-ci.com/AraBlocks/ara-reward-dcdn.svg?token=r6p7pesHZ9MRJsVsrYFe&branch=master)](https://travis-ci.com/AraBlocks/ara-reward-dcdn)

An Ara Network node that runs a rewardable decentralized content distribution node.

## Status

> **Important reminder**: All Ara development is still in flux.

## Dependencies
- [Node](https://nodejs.org/en/download/)
- [ara-network][ara-network]
- [ara-reward-protocol](ara-reward-protocol)
- [ara-contracts](ara-contracts)

## Installation
```sh
$ npm install --save ara-reward-dcdn
```

## Usage

### Start

```sh
$ ard start -i <userDID>
```

### Download
```sh
$ ard download -d <contentDID> -i <userDID>
```

### Seed
```sh
$ ard seed -d <contentDID> -i <userDID>
```

### Metadata
```sh
$ ard metadata -d <contentDID> -i <userDID>
```

## API

* [dcdn](#dcdn)
* [dcdn.start](#dcdnstart)
* [dcdn.stop](#dcdnstop)
* [dcdn.join](#dcdnjoin)
* [dcdn.unjoin](#dcdnunjoin)
* [dcdn.on('progress', did, downloaded, total)](#onprogress)
* [dcdn.on('peer-update', did, count)](#onpeerupdate)
* [dcdn.on('download-complete', did)](#ondownloadcomplete)
* [dcdn.on('request-complete', did)](#onrequestcomplete)


<a name="dcdn"></a>
### `dcdn(opts)`
Constructs a new dcdn instance. 

- `opts`
  - `userID` - The `DID` of the user
  - `password` - The password of the user
  - `queue` - A transaction queue, for queuing blockchain transactions. See `src/autoqueue.js`

<a name="dcdnstart"></a>
### `start()`
Starts running the DCDN node in the latest configuration.

<a name="dcdnstop"></a>
### `stop()`
Stops running the DCDN node.

<a name="dcdnjoin"></a>
### `join(opts)`

Joins a hyperswarm for a given AFS and replicates for a reward. Adds the interested details to the node's configuration. **Note**: this will also start the node and load the previous configuration.

- `opts`
  - `did` - The `DID` of the interested AFS
  - `upload` - Whether or not to upload
  - `download` - Whether or not to download
  - `metaOnly` - Sync on the metadata
  - `price` - The minimum cost required to replicate
  - `maxPeers` - The max peers desired for replication
  - `jobId` - *optional* The job ID to use for the download

<a name="dcdnunjoin"></a>
### `unjoin(opts)`

Leaves a hyperswarm for a given AFS and removes interest from the node's configuration

- `opts`
  - `did` - The `DID` of the interested AFS

<a name="onprogress"></a>
### `dcdn.on('progress', did, downloaded, total)`

Emitted when a data block has been downloaded

  - `did` - The `DID` of the AFS
  - `downloaded` - The number of data blocks downloaded
  - `total` - The total number of data blocks

<a name="onpeerupdate"></a>
### `dcdn.on('peer-update', did, count)`

Emitted when a peer has been added or removed from an AFS

  - `did` - The `DID` of the AFS
  - `count` - The number of peers connected

<a name="ondownloadcomplete"></a>
### `dcdn.on('download-complete', did)`

Emitted when the download is complete and the data is ready

  - `did` - The `DID` of the AFS

<a name="onrequestcomplete"></a>
### `dcdn.on('request-complete', did)`

Emitted when the peers have been rewarded and the job is complete

  - `did` - The `DID` of the AFS

## Configuration
[ara-runtime-configuration][ara-runtime-configuration] is a dependency of [ara-network][ara-network] and will read from the nearest `.ararc`.  Install [ara-runtime-configuration][ara-runtime-configuration] separately to specify default values not present in an `.ararc`.

## Contributing
- [Commit message format](/.github/COMMIT_FORMAT.md)
- [Commit message examples](/.github/COMMIT_FORMAT_EXAMPLES.md)
- [How to contribute](/.github/CONTRIBUTING.md)

## See Also
- [ara-network][ara-network]

## License
LGPL-3.0

[ara-network]: https://github.com/arablocks/ara-network
[ara-runtime-configuration]: https://github.com/arablocks/ara-runtime-configuration
[ara-reward-protocol]:https://github.com/arablocks/ara-reward-protocol
[ara-contracts]:https://github.com/arablocks/ara-contracts
[ara-filesystem]:https://github.com/arablocks/ara-filesystem