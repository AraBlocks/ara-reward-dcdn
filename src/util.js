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
  Countdown
}
