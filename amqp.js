process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';

const path = require('path');
const { promisify } = require('util');
const config = require('config');
const amqp = require('amqp-connection-manager');


// init default config
const ourConfigDir = path.join(__dirname, 'config');
const baseConfig = config.util.loadFileConfigs(ourConfigDir);
config.util.setModuleDefaults('amqp', baseConfig);

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]; // eslint-disable-line no-param-reassign
  }
}

const connectionUser = config.get('amqp.user');
const connectionPassword = config.get('amqp.password');
const connectionURLs = shuffleArray(config.get('amqp.hosts')
  .map(host => `amqp://${connectionUser}:${connectionPassword}@${host}`));

const connectionManager = amqp.connect(connectionURLs, { json: true });
connectionManager.on('connect', c => console.log(`amqp connected to ${c.url}`));
connectionManager.on('disconnect', () => console.warn(`amqp disconnected (${config.amqp.url})`));


async function isReachable() {
  if (connectionManager.isConnected()) {
    return true;
  }
  throw new Error('amqp is not connected');
}



module.exports = {
  isReachable,

};
