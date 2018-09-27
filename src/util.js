class AutoQueue {
  constructor(onError) {
    this.onError = onError
    this.queue = []
  }

  append(transaction) {
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

    if (1 == this.queue.length) this.queue[0]()
  }
}

class Countdown {
  constructor(count, onComplete) {
    this.count = count
    this.onComplete = onComplete
  }

  decrement() {
    this.count--
    if (0 === this.count) {
      this.onComplete()
    }
  }
}

module.exports = {
  AutoQueue,
  Countdown
}
