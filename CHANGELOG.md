## [0.19.2](https://github.com/arablocks/ara-reward-dcdn/compare/0.18.0...0.19.2) (2019-11-08)


### Bug Fixes

* swarm config ([33c2683](https://github.com/arablocks/ara-reward-dcdn/commit/33c2683))


### Features

* add feed byteLength to event ([d6d4116](https://github.com/arablocks/ara-reward-dcdn/commit/d6d4116))



# [0.18.0](https://github.com/arablocks/ara-reward-dcdn/compare/0.16.0...0.18.0) (2019-02-26)


### Features

* **src/dcdn.js:** Add dryRunJoin function to get peer count ([81dbcd7](https://github.com/arablocks/ara-reward-dcdn/commit/81dbcd7))



# [0.16.0](https://github.com/arablocks/ara-reward-dcdn/compare/0.14.1...0.16.0) (2019-01-25)



## [0.14.1](https://github.com/arablocks/ara-reward-dcdn/compare/0.13.1...0.14.1) (2019-01-17)


### Bug Fixes

* **dcdn:** better error handle ([da2b77e](https://github.com/arablocks/ara-reward-dcdn/commit/da2b77e))
* **farmer.js:** Typo ([0245e90](https://github.com/arablocks/ara-reward-dcdn/commit/0245e90))
* **src:** onError bug ([197462a](https://github.com/arablocks/ara-reward-dcdn/commit/197462a))



## [0.13.1](https://github.com/arablocks/ara-reward-dcdn/compare/0.9.0...0.13.1) (2018-12-20)


### Bug Fixes

* **hyperswarm:** don't connect unless looking up ([b85a75d](https://github.com/arablocks/ara-reward-dcdn/commit/b85a75d))


### Features

* **autoqueue:** resolved value from transaction ([88ee3df](https://github.com/arablocks/ara-reward-dcdn/commit/88ee3df))
* **dcdn:** emit peer-update ([7e1f82b](https://github.com/arablocks/ara-reward-dcdn/commit/7e1f82b))
* **requester:** resolve peer ([5a58b0a](https://github.com/arablocks/ara-reward-dcdn/commit/5a58b0a))



# [0.9.0](https://github.com/arablocks/ara-reward-dcdn/compare/0.2.0...0.9.0) (2018-12-10)


### Bug Fixes

* **ard:** removed onClose from base ard ([7712db3](https://github.com/arablocks/ara-reward-dcdn/commit/7712db3))
* **bin:** fix passing in did ([2139a09](https://github.com/arablocks/ara-reward-dcdn/commit/2139a09))
* **dcdn:** await unjoin on metadata sync ([8bf601f](https://github.com/arablocks/ara-reward-dcdn/commit/8bf601f))
* **dcdn:** fix for timeouts on dht connections ([3bfb408](https://github.com/arablocks/ara-reward-dcdn/commit/3bfb408))
* **dcdn:** rounding error ([52b14e0](https://github.com/arablocks/ara-reward-dcdn/commit/52b14e0))
* **dcdn:** switch jobs and config ([b0d872c](https://github.com/arablocks/ara-reward-dcdn/commit/b0d872c))
* **hyperswarm:** enable multiple topics per peer. Allow for 0x in front of jobId ([18488d3](https://github.com/arablocks/ara-reward-dcdn/commit/18488d3))
* **metadata:** replicate metadata during download ([a187c33](https://github.com/arablocks/ara-reward-dcdn/commit/a187c33))
* **package:** lock ara-filesystem due to contract change without minor bump ([79fac7e](https://github.com/arablocks/ara-reward-dcdn/commit/79fac7e))
* **requester:** finalize, rather than destroy feeds ([3f19e33](https://github.com/arablocks/ara-reward-dcdn/commit/3f19e33))
* **requester:** handle hire but no data received ([fc60389](https://github.com/arablocks/ara-reward-dcdn/commit/fc60389))
* **requester:** handle receipt timeout ([50777df](https://github.com/arablocks/ara-reward-dcdn/commit/50777df))
* **requester:** only try to send rewards once ([4bcbc5b](https://github.com/arablocks/ara-reward-dcdn/commit/4bcbc5b))
* **shipright:** fix for windows ([a796a55](https://github.com/arablocks/ara-reward-dcdn/commit/a796a55))
* **tests:** removed need for network ([ee37195](https://github.com/arablocks/ara-reward-dcdn/commit/ee37195))
* handle invalid agreement. handle no password. handle feed.length == 0 ([37bfc0e](https://github.com/arablocks/ara-reward-dcdn/commit/37bfc0e))
* **src/hyperswarm.js:** Check for cb in destroy ([ff24cc1](https://github.com/arablocks/ara-reward-dcdn/commit/ff24cc1))
* **util:** safely handle no password ([0515798](https://github.com/arablocks/ara-reward-dcdn/commit/0515798))


### Features

* **autoqueue:** synchronous transactions ([80973c0](https://github.com/arablocks/ara-reward-dcdn/commit/80973c0))
* **dcdn:** default reward to 10% of price ([5dadb09](https://github.com/arablocks/ara-reward-dcdn/commit/5dadb09))
* **dcdn:** metadata replication ([053367f](https://github.com/arablocks/ara-reward-dcdn/commit/053367f))
* **farmer:** check budget ([7b717b3](https://github.com/arablocks/ara-reward-dcdn/commit/7b717b3))
* **farmer:** validate job owner ([b6f4c0c](https://github.com/arablocks/ara-reward-dcdn/commit/b6f4c0c))
* **metadata:** debug listeners for metasync ([718acd5](https://github.com/arablocks/ara-reward-dcdn/commit/718acd5))
* **metadata:** signals when metadata sync. Added hyperswarm override for timeout ([7a3e22f](https://github.com/arablocks/ara-reward-dcdn/commit/7a3e22f))
* **user:** better logs for missing/incorrect passwords ([98381a6](https://github.com/arablocks/ara-reward-dcdn/commit/98381a6))
* add signing and verifying utilities ([ee02a74](https://github.com/arablocks/ara-reward-dcdn/commit/ee02a74))
* add userDid to the directory path ([7b435c5](https://github.com/arablocks/ara-reward-dcdn/commit/7b435c5))
* contract signature ([10377c9](https://github.com/arablocks/ara-reward-dcdn/commit/10377c9))



# [0.2.0](https://github.com/arablocks/ara-reward-dcdn/compare/0.1.0...0.2.0) (2018-11-07)


### Bug Fixes

* **bin:** use new getIdentifiter ([278ef0e](https://github.com/arablocks/ara-reward-dcdn/commit/278ef0e))
* **dcdn:** await close ([723bed3](https://github.com/arablocks/ara-reward-dcdn/commit/723bed3))


### Features

* **dcdn:** enable join with upload and download true ([a702c4b](https://github.com/arablocks/ara-reward-dcdn/commit/a702c4b))



# [0.1.0](https://github.com/arablocks/ara-reward-dcdn/compare/0.0.2...0.1.0) (2018-10-23)



## [0.0.2](https://github.com/arablocks/ara-reward-dcdn/compare/0.0.1...0.0.2) (2018-10-23)



## [0.0.1](https://github.com/arablocks/ara-reward-dcdn/compare/0844928...0.0.1) (2018-10-09)


### Bug Fixes

* **bin:** await fix ([07c0c30](https://github.com/arablocks/ara-reward-dcdn/commit/07c0c30))
* **farm:** listeners needs to use specific afs download opts ([451d5d2](https://github.com/arablocks/ara-reward-dcdn/commit/451d5d2))
* **farm:** prioritizing did over key ([1179756](https://github.com/arablocks/ara-reward-dcdn/commit/1179756))
* **requester:** fixed out-of-scope this ([a1abbd7](https://github.com/arablocks/ara-reward-dcdn/commit/a1abbd7))
* **requester:** oncomplete refactor ([898cb31](https://github.com/arablocks/ara-reward-dcdn/commit/898cb31))
* **src:** changed name to channel for swarm ([409f3f4](https://github.com/arablocks/ara-reward-dcdn/commit/409f3f4))
* **src:** create dcdn folder prior to read ([b5c0aa8](https://github.com/arablocks/ara-reward-dcdn/commit/b5c0aa8))
* **src:** name change fix from wallet ([ae5dcb5](https://github.com/arablocks/ara-reward-dcdn/commit/ae5dcb5))


### Features

* **download:** added download visualizer ([5840174](https://github.com/arablocks/ara-reward-dcdn/commit/5840174))
* **rc:** use rc to define job and config store ([331f645](https://github.com/arablocks/ara-reward-dcdn/commit/331f645))
* **src:** added stopService ([0844928](https://github.com/arablocks/ara-reward-dcdn/commit/0844928))



