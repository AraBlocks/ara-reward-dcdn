<img src="https://github.com/arablocks/ara-module-template/blob/master/ara.png" width="30" height="30" />  ara-network-node-dcdn-farm
====================

[![Build Status](https://travis-ci.com/AraBlocks/ara-network-node-dcdn-farm.svg?token=r6p7pesHZ9MRJsVsrYFe&branch=master)](https://travis-ci.com/AraBlocks/ara-network-node-dcdn-farm)

An Ara Network node that runs a rewardable decentralized content distribution node.

## Status
**Dependent upon ara-filesystem, ara-identity, ara-network**

>**HOW TO RUN**: [Temp README type doc](https://docs.google.com/document/d/1yC2T3NRUN2PcxWxm-wjYzipyaVmmuYV8OwdPN1CErKs)

> **Important reminder**: All Ara development is still in flux.

## Dependencies
- [Node](https://nodejs.org/en/download/)
- [ara-network][ara-network]
- [ara-farming-protocol](ara-farming-protocol)

## Installation
```sh
$ npm install ara-network ara-network-node-dcdn-farm
```

## Configuration
[ara-runtime-configuration][ara-runtime-configuration] is a dependency of [ara-network][ara-network] and will read from the nearest `.ararc`.  Install [ara-runtime-configuration][ara-runtime-configuration] separately to specify default values not present in an `.ararc`.

### Examples
#### Command Line (ann)
Invoke a network node with the `ann` (or `ara-network-node`) command line interface for :
```sh
$ ann --t dcdn
```

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
[ara-farming-protocol]:https://github.com/littlstar/farming-protocol
