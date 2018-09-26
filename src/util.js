class AutoQueue {
    constructor(onError){
        this.onError = onError
        this.queue = []
    }

    async append(transaction) {
        const self = this
        const onComplete = (err) => {
            if (err) self.onError(err)
            else {
                self.queue.shift()
                if (self.queue.length > 0) self.queue[0]()
            }
        }

        this.queue.push(() => {
            transaction(onComplete)
        })

        if (this.queue.length == 1) this.queue[0]()
    }
}

module.exports = {
    AutoQueue
}