'use strict';

const aws = require('aws-sdk');
const AutoScaleConfig = require('./AutoScaleConfig');

let AUTO_SCALE_CONFIG_CACHE = null;

/**
 * Repository class to access configuration data
 */
class AutoScaleConfigRepository {

  /**
   * create instance of DB auto scale config repository
   * @param ddbOptions - options of DynamoDB
   * @param configTableName - table name which stores auto scale config data
   */
  constructor(ddbOptions, configTableName) {
    //assign config table name and make it required
    this.tableName = configTableName || process.env.CONFIG_TABLE_NAME;
    if (!this.tableName) throw new Error('Config table name is required');

    //create document DB instance
    this.db = new aws.DynamoDB.DocumentClient(ddbOptions || {});
  }

  /**
   * load all config items from database
   * @returns {Promise.<[AutoScaleConfig]>}
   */
  load() {
    // return from cache if we have cached values
    if (AUTO_SCALE_CONFIG_CACHE && AUTO_SCALE_CONFIG_CACHE.length)
      return Promise.resolve(AUTO_SCALE_CONFIG_CACHE);

    return this.db.scan({
      TableName: this.tableName
    }).promise().then(result => {
      AUTO_SCALE_CONFIG_CACHE = result.Items.map(AutoScaleConfig.create);
      return AUTO_SCALE_CONFIG_CACHE;
    });
  }

  /**
   * return config item for specified table
   * @param tableName - table name to get config for
   * @returns {Promise.<AutoScaleConfig>}
   */
  fetch(tableName) {
    // return from cache if we have cached values
    if (AUTO_SCALE_CONFIG_CACHE && AUTO_SCALE_CONFIG_CACHE.length)
      return Promise.resolve(AUTO_SCALE_CONFIG_CACHE.find(x => x.tableName === tableName));

    return this.db.query({
      TableName: this.tableName,
      KeyConditionExpression: 'tableName = :tableName',
      ExpressionAttributeValues: { ':tableName': tableName }
    }).promise().then(result => AutoScaleConfig.create(result.Items[0]));
  }

  /**
   * save config item to database
   * @param config - config item to be saved
   * @returns {Promise<Boolean>}
   */
  save(config) {
    if (config.constructor.name === 'Object')
      config = AutoScaleConfig.create(config);

    return this.db.put({
      TableName: this.tableName,
      Item: config
    }).promise().then(() => {
      // empty cache
      AUTO_SCALE_CONFIG_CACHE = null;
      return true;
    });
  }

  /**
   * delete config item for specified table
   * @param tableName - table name to delete config for
   * @returns {Promise<Boolean>}
   */
  delete(tableName) {
    return this.db.delete({
      TableName: this.tableName,
      Key: { tableName: tableName }
    }).promise().then(() => {
      // remove item from cache
      if (!AUTO_SCALE_CONFIG_CACHE || !AUTO_SCALE_CONFIG_CACHE.length) return true;
      const remove = AUTO_SCALE_CONFIG_CACHE.find(x => x.tableName === tableName);
      const removeIndex = AUTO_SCALE_CONFIG_CACHE.indexOf(remove);
      AUTO_SCALE_CONFIG_CACHE.splice(removeIndex, 1);
      return true;
    });
  }
}

module.exports = AutoScaleConfigRepository;