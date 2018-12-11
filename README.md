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

## CLI
See [CLI docs](/docs/CLI-README.md)

## API
See [API docs](/docs/API-README.md)

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