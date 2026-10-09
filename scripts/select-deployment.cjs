const fs = require('node:fs')
const path = require('node:path')
const { validateDeployment } = require('./validate-deployment.cjs')

function selectDeployment(channel) {
  if (!['test', 'public'].includes(channel)) throw new Error('Usage: select-deployment.cjs test|public')
  const configDir = path.join(__dirname, '../config')
  const deployment = validateDeployment(JSON.parse(fs.readFileSync(path.join(configDir, 'deployment.' + channel + '.json'), 'utf8')))
  if (deployment.channel !== (channel === 'test' ? 'lan' : 'public')) throw new Error('Deployment channel mismatch')
  const target = path.join(configDir, 'deployment.json')
  const temporary = target + '.' + process.pid + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(deployment, null, 2) + '\n')
  fs.renameSync(temporary, target)
  console.log('Selected ' + channel + ' deployment')
  return deployment
}

module.exports = { selectDeployment }
if (require.main === module) selectDeployment(process.argv[2])
