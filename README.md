![Jest unit testing](https://github.com/maurice2k/querycheck/workflows/Jest%20unit%20testing/badge.svg)

# QueryCheck

*QueryCheck* is a logical JSON query evaluator which uses the [MongoDB query style](https://docs.mongodb.com/manual/tutorial/query-documents/).

The following comparision operators are supported:
* [\$eq](https://docs.mongodb.com/manual/reference/operator/query/eq/)
* [\$gt](https://docs.mongodb.com/manual/reference/operator/query/gt/)
* [\$gte](https://docs.mongodb.com/manual/reference/operator/query/gte/)
* [\$in](https://docs.mongodb.com/manual/reference/operator/query/in/)
* [\$lt](https://docs.mongodb.com/manual/reference/operator/query/lt/)
* [\$lte](https://docs.mongodb.com/manual/reference/operator/query/lte/)
* [\$ne](https://docs.mongodb.com/manual/reference/operator/query/ne/)
* [\$regex](https://docs.mongodb.com/manual/reference/operator/query/regex/)

As well as the following logical operators:
* [\$and](https://docs.mongodb.com/manual/reference/operator/query/and/)
* [\$or](https://docs.mongodb.com/manual/reference/operator/query/or/)
* [\$not](https://docs.mongodb.com/manual/reference/operator/query/not/)

## Installation

Install with npm:

```bash
$ npm install maurice2k/querycheck
```

## Simple example

```javascript

const QueryCheck = require('querycheck');

const vars = {
    now: {
        isoDate: "2020-05-21",
        isoTime: "13:59:48",
    }
};

const openingHours = new QueryCheck(
    {
        "now.isoDate": {
            "$not": {
                "$in": ["2019-12-25", "2019-12-26", "2019-12-31", "2020-01-01"]
            }
        },
        "now.isoTime": {
            "$gt": "10:00",
            "$lt": "18:00"
        }
    }
);

if (openingHours.test(vars)) {
    console.log("We're OPEN!");
} else {
    console.log("Sorry, we're CLOSED!");
}

```


## License

*QueryCheck* is available under the MIT [license](LICENSE).
