 ### ard(1)
#### Abstract
All other commands prepended with `ard-` execute as a child of this command
#### Usage
```sh
usage: ard <command> [-hDV] [<args>]
```
#### Options
| Flag(s) | Description | Type |
|--|--|--|
|-h, --help|Show this message||
|-V, --version|Show version number|[boolean]|
|-D, --debug|Enable debug output (Sets 'DEBUG+=ard:*,arp*')||
|-i, --identity|A valid, local, and resolvable Ara identity DID URI of the owner of the AFS. You will be prompted for the associated passphrase|[string] [required]|



---
 ### ard-start(1)
#### Abstract
Start DCDN in last configuration
#### Usage
```sh
usage: ard start [-hDV]
```
#### Options
| Flag(s) | Description | Type |
|--|--|--|
|-h, --help|Show this message||
|-V, --version|Show version number|[boolean]|
|-i, --identity|A valid, local, and resolvable Ara identity DID URI of the owner of the AFS. You will be prompted for the associated passphrase|[string] [required]|



---
 ### ard-download(1)
#### Abstract
Download AFS from network
#### Usage
```sh
usage: ard download [-hDV] [<args>]
```
#### Options
| Flag(s) | Description | Type |
|--|--|--|
|-h, --help|Show this message||
|-V, --version|Show version number|[boolean]|
|-i, --identity|A valid, local, and resolvable Ara identity DID URI of the owner of the AFS. You will be prompted for the associated passphrase|[string] [required]|
|-d, --did|A valid and resolvable Ara identity DID URI of an AFS.|[string]|
|-r, --reward|The maximum reward you want to receive/give for uploading/downloading an AFS. The default is 10% of the price of an AFS.|[number]|
|-p, --peers|The maximum number of peers you want to connect with when uploading/downloading an AFS.  |[number]|
|--job-id|The job Id for downloading the AFS.|[string]|
|--meta-only|Whether to only upload/download the metadata  ||



---
 ### ard-seed(1)
#### Abstract
Host AFS for network
#### Usage
```sh
usage: ard seed [-hDV] [<args>]
```
#### Options
| Flag(s) | Description | Type |
|--|--|--|
|-h, --help|Show this message||
|-V, --version|Show version number|[boolean]|
|-i, --identity|A valid, local, and resolvable Ara identity DID URI of the owner of the AFS. You will be prompted for the associated passphrase|[string] [required]|
|-d, --did|A valid and resolvable Ara identity DID URI of an AFS.|[string]|
|-r, --reward|The maximum reward you want to receive/give for uploading/downloading an AFS. The default is 10% of the price of an AFS.|[number]|
|-p, --peers|The maximum number of peers you want to connect with when uploading/downloading an AFS.  |[number]|
|--job-id|The job Id for downloading the AFS.|[string]|
|--meta-only|Whether to only upload/download the metadata  ||


