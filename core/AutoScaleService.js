'use strict';

const aws = require('aws-sdk');
const moment = require('moment');
const Promise = require('bluebird');

function getAttribute(tableDescription, attribute, indexName) {
  return !indexName ?

    tableDescription[attribute.replace('?', 'Table')] :

    tableDescription.GlobalSecondaryIndexes.find(
      i => i.IndexName === indexName
    )[attribute.replace('?', 'Index')];
}

class AutoScaleService {

  /**
   * create instance of DB auto scaler
   * @param awsOptions - AWS configuration options
   * @param configRepository - table scaling config repository
   * @param logService - logging service
   */
  constructor(awsOptions, configRepository, logService) {
    this.db = Promise.promisifyAll(
      new aws.DynamoDB(awsOptions || {})
    );

    this.cw = Promise.promisifyAll(
      new aws.CloudWatch(awsOptions || {})
    );

    this.logger = logService;
    this.configRepository = configRepository;

    if (!this.logger) throw new Error('logService is required');
    if (!this.configRepository) throw new Error('configRepository is required');
  }

  /**
   * scale all configured tables up
   * @returns {Promise<*>}
   */
  scaleUpTables() {
    this.logger.log('SCALE UP STARTED...');

    // load all tables from configuration and scale up
    return this.configRepository.load()
      .map(this.scaleUpTable)
      .then(res => this.logger.log('SCALE UP SUCCEEDED.', res))
      .catch(err => this.logger.log('SCALE UP FAILED!', err));
  }

  /**
   * scale all configured tables down
   * @returns {Promise<*>}
   */
  scaleDownTables() {
    this.logger.log('SCALE DOWN STARTED...');

    // load all tables from configuration and scale down
    return this.configRepository.load()
      .map(this.scaleDownTable)
      .then(res => this.logger.log('SCALE DOWN SUCCEEDED.', res))
      .catch(err => this.logger.log('SCALE DOWN FAILED!', err));
  }

  /**
   * scale specified table up
   * @param config - table auto-scaling configuration
   * @returns {Promise<*>}
   */
  scaleUpTable(config) {
    this.logger.log('SCALE UP TABLE:', config);

    return this.scaleTable(config, 'up')
      .then(res => this.logger.log('SCALE UP TABLE SUCCEEDED.', res))
      .catch(err => this.logger.log('SCALE UP TABLE FAILED!', err));
  }

  /**
   * scale specified table down
   * @param config - table auto-scaling configuration
   * @returns {Promise<*>}
   */
  scaleDownTable(config) {
    this.logger.log('SCALE DOWN TABLE:', config);

    return this.scaleTable(config, 'down')
      .then(res => this.logger.log('SCALE DOWN TABLE SUCCEEDED.', res))
      .catch(err => this.logger.log('SCALE DOWN TABLE FAILED!', err));
  }

  /**
   * perform scale for specified table auto-scale config
   * @param config - table auto-scaling configuration
   * @param direction - scale direction
   * @returns {Promise<*>}
   */
  scaleTable(config, direction) {
    this.logger.log('Getting table schema:', config.tableName);
    const analyzeDuration = config[direction + 'Duration'];
    const shared = {};

    // get table schema from DDB
    return this.getTableSchema(config.tableName).then(table => {
      shared.table = table;
      // get get consumed capacity units for table for time period specified in configuration
      return this.getConsumedCapacityUnits().forTable(table).forTimespan(analyzeDuration);
    }).then(metrics => {
      const table = shared.table;

      // prepare table update request
      const tableUpdateRequest = {
        TableName: table.TableName,

        ProvisionedThroughput: {
          ReadCapacityUnits: 0,
          WriteCapacityUnits: 0
        },

        // include global secondary indexes scale from configuration
        GlobalSecondaryIndexUpdates: (table.GlobalSecondaryIndexes || []).map(index => ({
          Update: {
            IndexName: index.IndexName,
            ProvisionedThroughput: {
              ReadCapacityUnits: 0,
              WriteCapacityUnits: 0
            }
          }
        }))
      };

      // update counters to determine if we
      // need to run table update operation
      const updateCounts = {
        total: 0,
        table: 0,
        indexes: { }
      };

      // loop through consumed capacity metrics
      metrics.forEach(point => {
        this.logger.log('Received %s metric for %s:%s: Sum: %d Per second: %d',
          point.metricName,
          point.tableName,
          point.indexName || 'No index',
          point.Sum || 0,
          (point.Sum || 0) / analyzeDuration.asSeconds()
        );

        // skip table/indexes that are not active
        const status = getAttribute(table, '?Status', point.indexName);
        if (status !== 'ACTIVE') return this.logger.log(
          `${point.tableName}:${point.indexName} is not ACTIVE, skipping...`
        );

        // don't scale down if we just scaled up
        if (direction === 'down') {
          const lastIncrease = moment(
            getAttribute(table, 'ProvisionedThroughput', point.indexName).LastIncreaseDateTime
          );

          if (lastIncrease > moment().subtract(analyzeDuration.asSeconds))
            return this.logger.log(`${point.tableName}:${point.indexName} was just scaled up, skipping...`);
        }

        // determine is it Read or Write metrics
        const method = point.metricName.replace('Consumed', '').replace('CapacityUnits', '').toLowerCase();

        // get provisioned throughput for table or index
        const provisionedThroughput = (point.indexName ?
            table.GlobalSecondaryIndexes.find(_ => _.IndexName === point.indexName) : table
        ).ProvisionedThroughput;

        // get pointer to target throughput property
        const targetThroughput = (point.indexName ?
            tableUpdateRequest.GlobalSecondaryIndexUpdates.find(_ => _.Update.IndexName === point.indexName).Update : tableUpdateRequest
        ).ProvisionedThroughput;

        // add update counter for index
        if (point.indexName && !updateCounts.indexes[point.indexName])
          updateCounts.indexes[point.indexName] = 0;

        // calculate target throughput units based on scale direction
        const unitsField = point.metricName.replace('Consumed', '');
        const provisioned = provisionedThroughput[unitsField];
        const consumed = (point.Sum || 0) / analyzeDuration.asSeconds();
        const newProvisioned = Math.floor(config.scale(point.indexName)[direction].method(method).from(provisioned).to(consumed));

        targetThroughput[unitsField] = newProvisioned;

        // log and increment counters if value changed
        if (newProvisioned !== provisioned) {
          updateCounts.total++;
          if (!point.indexName) updateCounts.table++;
          else updateCounts.indexes[point.indexName]++;

          // log results
          this.logger.log('Scaling: %j', {
            table: config.tableName,
            indexName: point.indexName,
            parameter: unitsField,
            action: 'SCALE ' + direction.toUpperCase(),
            consumed: consumed,
            provisioned: provisioned,
            scaled: newProvisioned
          });
        }
      });

      // remove unchanged sections from update request
      if (!updateCounts.table) delete tableUpdateRequest.ProvisionedThroughput;

      tableUpdateRequest.GlobalSecondaryIndexUpdates = tableUpdateRequest.GlobalSecondaryIndexUpdates
        .filter(index => updateCounts.indexes[index.Update.IndexName]);

      if (!tableUpdateRequest.GlobalSecondaryIndexUpdates.length)
        delete tableUpdateRequest.GlobalSecondaryIndexUpdates;

      // send table update request if we have updates
      return updateCounts.total === 0 ? Promise.resolve(table) :
        this.db.updateTableAsync(tableUpdateRequest);
    });
  }

  /**
   * get table schema details
   * @param tableName - table name to load data for
   * @returns {*}
   */
  getTableSchema(tableName) {
    return this.db.describeTableAsync({ TableName: tableName }).get('Table');
  }

  /**
   * get consumed capacity units resolver
   * @param metrics - metrics to be resolved
   * @returns {*}
   */
  getConsumedCapacityUnits(metrics) {
    const self = this;

    // get both read and write if missed
    if (!metrics) metrics = [
      'ConsumedReadCapacityUnits',
      'ConsumedWriteCapacityUnits'
    ];

    // make sure we always receive list of metrics
    if (typeof metrics === 'string') metrics = [metrics];

    return {
      forTable(nameOrSchema) {
        return {
          forTimespan(timeSpanDuration) {
            const resolveTableSchema = typeof nameOrSchema === 'string' ?
              self.getTableSchema(nameOrSchema) : Promise.resolve(nameOrSchema);

            const endDate = moment();
            const startDate = moment().subtract(timeSpanDuration);

            return resolveTableSchema.then(tableSchema => {
              // create get metrics request object
              const getRequest = (metricName, indexName) => {
                const result = {
                  MetricName: metricName,
                  Namespace: 'AWS/DynamoDB',

                  Statistics: ['Average', 'Sum', 'Minimum', 'Maximum'],
                  Unit: 'Count',

                  Period: timeSpanDuration.asSeconds(),
                  StartTime: startDate.toDate(),
                  EndTime: endDate.toDate(),

                  Dimensions: [{
                    Name: 'TableName',
                    Value: tableSchema.TableName
                  }]
                };

                // add index name if exists
                if (indexName) result.Dimensions.push({
                  Name: 'GlobalSecondaryIndexName',
                  Value: indexName
                });

                return result;
              };

              const getTableMetricsRequests = [];

              // build requests for supplied all metrics
              metrics.forEach(metricName => {
                // push table request for metric
                getTableMetricsRequests.push(
                  getRequest(metricName)
                );

                // push index requests for metric
                (tableSchema.GlobalSecondaryIndexes || []).forEach(index => getTableMetricsRequests.push(
                  getRequest(metricName, index.IndexName)
                ))
              });

              return Promise.map(getTableMetricsRequests, request => {
                return self.cw.getMetricStatisticsAsync(request).then(response => {
                  const data = response.Datapoints[0] || {};

                  // set metric and table names for data
                  data.metricName = request.MetricName;
                  data.tableName = request.Dimensions[0].Value;

                  // set index name for data if it is for index
                  if (request.Dimensions.length > 1)
                    data.indexName = request.Dimensions[1].Value;

                  return data;
                });
              });
            });
          }
        }
      }
    };
  }
}

module.exports = AutoScaleService;