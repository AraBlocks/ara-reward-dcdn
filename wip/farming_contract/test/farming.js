/* eslint no-undef: "off" */

const Farming = artifacts.require('./Farming.sol')

contract('Farming', async (accounts) => {
  it('should deposit budget for a job using the first account', async () => {
    const jobId = 1
    const budget = 1000

    // Get accounts
    const account_one = accounts[0]

    const instance = await Farming.deployed()
    await instance.submitJob(jobId, { from: account_one, value: budget })

    const ending_balance = await instance.getJobBudget.call(jobId)
    assert.equal(ending_balance, budget)
  })

  it('should submit reward for a farmer', async () => {
    const jobId = 1
    const reward = 1000

    // Get accounts
    const account_one = accounts[0]
    const accounts_two = accounts[1]

    const instance = await Farming.deployed()
    await instance.submitReward(jobId, accounts_two, reward, {
      from: account_one
    })

    const submitted_reward = await instance.getRewardBalance.call(
      jobId,
      accounts_two
    )
    assert.equal(submitted_reward, reward)
  })

  it('reward should be emptied after claimed', async () => {
    const jobId = 1
    const reward = 1000

    // Get accounts
    const account_one = accounts[0]
    const accounts_two = accounts[1]

    const instance = await Farming.deployed()
    await instance.submitReward(jobId, accounts_two, reward, {
      from: account_one
    })

    await instance.claimReward(jobId, accounts_two, {
      from: accounts_two
    })

    const empty_reward = await instance.getRewardBalance.call(
      jobId,
      accounts_two
    )
    assert.equal(empty_reward, 0)
  })
})
