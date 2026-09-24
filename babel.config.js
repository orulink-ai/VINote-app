require('./scripts/validate-deployment.cjs').validateDeployment(require('./config/deployment.json'));
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
