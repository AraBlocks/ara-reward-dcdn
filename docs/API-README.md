<a name="DCDN"></a>

## DCDN
A rewardable DCDN node on the Ara Network

**Kind**: global class  
**Emits**: <code>DCDN#event:info</code>, <code>DCDN#event:warn</code>, [<code>peer-update</code>](#DCDN+event_peer-update), [<code>download-progress</code>](#DCDN+event_download-progress), [<code>download-complete</code>](#DCDN+event_download-complete), [<code>request-complete</code>](#DCDN+event_request-complete)  

* [DCDN](#DCDN)
    * [new DCDN()](#new_DCDN_new)
    * [.start()](#DCDN+start) ⇒ <code>null</code>
    * [.stop()](#DCDN+stop) ⇒ <code>null</code>
    * [.dryRunJoin()](#DCDN+dryRunJoin)
    * [.join()](#DCDN+join) ⇒ <code>AFS</code>
    * [.unjoin()](#DCDN+unjoin) ⇒ <code>null</code>
    * ["download-complete" (did)](#DCDN+event_download-complete)
    * ["request-complete" (did)](#DCDN+event_request-complete)
    * ["download-progress" (did, downloaded, total)](#DCDN+event_download-progress)
    * ["peer-update" (did, count)](#DCDN+event_peer-update)

<a name="new_DCDN_new"></a>

### new DCDN()
Constructs a new dcdn instance


| Param | Type | Description |
| --- | --- | --- |
| opts.userId | <code>String</code> | The user's `did` |
| opts.password | <code>String</code> | The user's password |
| [opts.queue] | <code>Object</code> | The transaction queue |

<a name="DCDN+start"></a>

### dcdN.start() ⇒ <code>null</code>
Start running the DCDN node in the latest configuration

**Kind**: instance method of [<code>DCDN</code>](#DCDN)  
**Access**: public  
<a name="DCDN+stop"></a>

### dcdN.stop() ⇒ <code>null</code>
Stop running the DCDN node

**Kind**: instance method of [<code>DCDN</code>](#DCDN)  
**Access**: public  
<a name="DCDN+dryRunJoin"></a>

### dcdN.dryRunJoin()
Determines peer count for an AFS _before_ purchase.

**Kind**: instance method of [<code>DCDN</code>](#DCDN)  
**Emits**: [<code>peer-update</code>](#DCDN+event_peer-update)  
**Access**: public  

| Param | Type | Description |
| --- | --- | --- |
| opts.did | <code>String</code> | The `did` of the AFS |

<a name="DCDN+join"></a>

### dcdN.join() ⇒ <code>AFS</code>
Joins a hyperswarm for a given AFS and replicates for a reward.
Adds the options to the node's configuration. **Note**: this will
also start the node and load the previous configuration.

**Kind**: instance method of [<code>DCDN</code>](#DCDN)  
**Returns**: <code>AFS</code> - Joined AFS  
**Access**: public  

| Param | Type | Description |
| --- | --- | --- |
| opts.did | <code>String</code> | The `did` of the AFS |
| opts.upload | <code>boolean</code> | Whether to seed the AFS |
| opts.download | <code>boolean</code> | Whether to download the AFS |
| [opts.metaOnly] | <code>boolean</code> | Whether to only replicate the metadata |
| [opts.price] | <code>string</code> | Price in Ara to distribute AFS |
| [opts.maxPeers] | <code>int</code> | The maximum peers for the AFS |
| [opts.jobId] | <code>String</code> | A job id for the AFS |

<a name="DCDN+unjoin"></a>

### dcdN.unjoin() ⇒ <code>null</code>
Leaves a hyperswarm for a given AFS and removes its options
from the node's configuration

**Kind**: instance method of [<code>DCDN</code>](#DCDN)  
**Access**: public  

| Param | Type | Description |
| --- | --- | --- |
| opts.did | <code>String</code> | The `did` of the AFS |

<a name="DCDN+event_download-complete"></a>

### "download-complete" (did)
Emitted when the download is complete and the data is ready

**Kind**: event emitted by [<code>DCDN</code>](#DCDN)  

| Param | Type | Description |
| --- | --- | --- |
| did | <code>string</code> | The `did` of the downloaded AFS |

<a name="DCDN+event_request-complete"></a>

### "request-complete" (did)
Emitted when the peers have been rewarded and the job is complete

**Kind**: event emitted by [<code>DCDN</code>](#DCDN)  

| Param | Type | Description |
| --- | --- | --- |
| did | <code>string</code> | The `did` of the downloaded AFS |

<a name="DCDN+event_download-progress"></a>

### "download-progress" (did, downloaded, total)
Emitted when a new data block has been downloaded

**Kind**: event emitted by [<code>DCDN</code>](#DCDN)  

| Param | Type | Description |
| --- | --- | --- |
| did | <code>string</code> | The `did` of the AFS |
| downloaded | <code>int</code> | The current number of downloaded blocks |
| total | <code>int</code> | The total number of blocks |

<a name="DCDN+event_peer-update"></a>

### "peer-update" (did, count)
Emitted when a peer has been added or removed from an AFS

**Kind**: event emitted by [<code>DCDN</code>](#DCDN)  

| Param | Type | Description |
| --- | --- | --- |
| did | <code>string</code> | The `did` of the AFS |
| count | <code>int</code> | The current number of peers |

