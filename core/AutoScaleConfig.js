'use strict';

const moment = require('moment');

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

function getConfigValue(self, subConfig) {
  return Object.assign({}, self || {}, self[subConfig] || {});
}

function timeSpanToDuration(timeSpan) {
  const tokens = timeSpan.split(' ');
  return moment.duration(parseInt(tokens[0]), tokens[1]);
}

const DEFAULTS = {
  min: parseInt(process.env.TROUGHPUTS_MIN),
  max: parseInt(process.env.TROUGHPUTS_MAX),

  increase: parseInt(process.env.TROUGHPUTS_INCREASE),
  threshold: parseFloat(process.env.TROUGHPUTS_THRESHOLD),

  upTimeSpan: process.env.ANALYZE_TIMESPAN_UP,
  downTimeSpan: process.env.ANALYZE_TIMESPAN_DOWN,

  get upDuration() {
    return timeSpanToDuration(this.upTimeSpan);
  },

  get downDuration() {
    return timeSpanToDuration(this.downTimeSpan);
  },

  scaleUp(consumedUnits, provisionedUnits, subConfig) {
    const config = getConfigValue(this, subConfig);
    if (config.isDisabled) return provisionedUnits;

    const result = consumedUnits < provisionedUnits * config.threshold ? provisionedUnits :
      Math.max(provisionedUnits + config.increase, consumedUnits + config.increase);
    
    return clamp(config.min, config.max, result);
  },

  scaleDown(consumedUnits, provisionedUnits, subConfig) {
    const config = getConfigValue(this, subConfig);
    if (config.isDisabled) return provisionedUnits;
    
    const result = (consumedUnits / config.threshold) - config.increase;
    return clamp(config.min, config.max, result);
  }
};

class AutoScaleConfig {

  static create(rawData) {
    return rawData ? new AutoScaleConfig(rawData) : null;
  }

  /**
   *
   * @param rawData - config raw data
   */
  constructor(rawData) {
    delete rawData.upDuration;
    delete rawData.downDuration;
    Object.assign(this, DEFAULTS, rawData);

    // table name is required
    if (!this.tableName) throw new Error('Table name is required');

    // build indexes configuration
    this.indexes = Array.isArray(rawData.indexes) ?

      // indexes can be supplied as array
      rawData.indexes.filter(_ => _.indexName).reduce((indexes, index) => {
        delete index.upDuration;
        delete index.downDuration;
        indexes[index.indexName] = Object.assign({}, DEFAULTS, index);
        return indexes;
      }, {}) :

      // or as dictionary object
      Object.getOwnPropertyNames(rawData.indexes || {}).reduce((indexes, indexName) => {
        delete rawData.indexes[indexName].upDuration;
        delete rawData.indexes[indexName].downDuration;
        indexes[indexName] = Object.assign({}, DEFAULTS, rawData.indexes[indexName]);
        return indexes;
      }, {});
  }

  scale(indexName) {
    const self = this;

    const dir = direction => ({
      method: subConfigName => ({
        from: provisionedUnits => ({
          to: consumedUnits => (self.indexes[indexName] || self)['scale' + direction](consumedUnits, provisionedUnits, subConfigName)
        })
      })
    });

    return {
      get up() { return dir('Up'); },
      get down() { return dir('Down'); }
    };
  }
}

module.exports = AutoScaleConfig;