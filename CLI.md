DCDN CLI
===
Command line interface for interacting with DCDN

## CLI

### dcdn(1)

#### Abstract

Command line interface runner for DCDN commands. A DCDN command is any command
found in a user's `PATH` or `PATHEXT` that is excutable and is prefixed with
a `DCDN-` in the name.


#### Usage

```sh
usage: dcdn: [-hDV] [--help] [--version]
[--debug] <command> [<args>]
```

#### Options
| Flag(s) | Description |
|--|--|
|-h, --help|  Show this message|
|-V, --version|  Show DCDN CLI version|
|-v, --verbose|  Show verbose output|
|-D, --debug|  Enable debug output (Sets 'DEBUG+=ara:dcdn:*')|

---
### dcdn-download(1)

#### Abstract

This command will initiate a download from peers

#### Usage

```sh
usage: dcdn download: [-h] [--help]
[options]
```

#### Options
| Flag(s) | Description |
|--|--|
|-h, --help|  Show this message|
|-V, --version|  Show DCDN CLI version|
|-v, --verbose|  Show verbose output|
|-d, --did|  DID  [string]|

---
### dcdn-publish(1)

#### Abstract

This command will publish afs

#### Usage

```sh
usage: dcdn publish: [-h] [--help]
[options]
```

#### Options
| Flag(s) | Description |
|--|--|
|-h, --help|  Show this message|
|-V, --version|  Show DCDN CLI version|
|-v, --verbose|  Show verbose output|
|-d, --did|  DID  [string]|
|-i, --identity|  Identity  [string]|
|-s, --secret|  Network key secret  [default: null]|
|-n, --name|  Network key name  [default: null]|
|-k, --keyring|  Path to keyring  [default: null]|
