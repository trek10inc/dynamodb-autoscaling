### Prerequisites

Install [Serverless framework](https://serverless.com/) globally:

`$ npm install -g serverless`

### Deployment

Install node modules and deploy serverless stack to AWS account

```
$ npm install
$ sls deploy --stage <stage name>
```

Stage flag is optional...

### Auto-Scale Lambdas

Auto-scaling lambdas are deployed with scheduled events which run *every 1 minute for scale up* and *every 6 hours for scale down* by default. Schedule settings can be adjusted in serverless.yml file.

### Configuration REST API

API gateway endpoints will be deployed to maintain auto-scaling configuration:

`GET https://api.domain.name/ddb-auto-scale/config` - Load all available configuration records.

`GET https://api.domain.name/ddb-auto-scale/config/{tabelName}` - Load configuration record for specified DynamoDB table.

`POST https://api.domain.name/ddb-auto-scale/config` - Save configuration record for DynamoDB table (see [Configuration Data Structure](#config) section below).

`DELETE https://api.domain.name/ddb-auto-scale/config/{tabelName}` - Delete configuration record for specified DynamoDB table.

### <a name="config"></a>Configuration Data Structure

All auto-scaling properties for specified DynamoDB table along with its global secondary indexes are described by configuration JSON object with following structure:

```
{
	tableName: name of DDB table to auto-scale (required)

	min: minimal capacity units (default 1)
	max: maximal capacity units (default 100)
	
	threshold: value which determines if we need to scale (scale up if consummed capacity units >= provisioned capacity units * threshold, default 0.8)
	increase: number of capacity units by which we increase (default 10)
	 
	upTimeSpan: a time span for which we analyze consummed capacity units for scale up (default to 5 minutes)
	downTimeSpan: a time span for which we analyze consummed capacity units for scale down (default to 30 minutes)
	
	indexes: array of indexes scale configuration [
		indexName: an index name to auto-scale (required)
		
		... similar configuration structure as for table ...
	]
}
```

