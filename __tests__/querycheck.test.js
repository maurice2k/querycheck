'use strict';

const QueryCheck = require('../src/querycheck.js');
const UnknownVariableException = QueryCheck.UnknownVariableException;

const vars = {
    now: {
        isWeekday: true,
        isHoliday: false,
        isoDate: "2020-05-21",
        isoTime: "13:59:48",
        isoDateTime: "2020-05-21T13:59:48"
    },
    myString: "this is a string",
    myStringFlavor: "strawberry",
    myStringPrime: "prime number 137",
    myInt: 137,
    myIntAsString: "137",
    myFloat: 137.12345,
    myBoolTrue: true,
    myBoolFalse: false,
    myNull: null,
    myArrayOfInts: [10, 20, 30, 40, 50],
    myArrayOfStrings: ["vanilla", "strawberry", "chocolate"],
    myArrayOfObjects: [{x: 10, y: 11}, {x: 20, y: 21}, {x: 40, y: 41}],
    mySimpleObject: {x: 30, y: 31},
    myLookup: {
        0: "zero",
        "1": "one",
        user: "maurice"
    },
    lookupKey: "user",
    myObject: {
        userName: "maurice",
        firstName: "First",
        lastName: "Last"
    },
    myEmptyArray: []
};


function simpleTests(strictMode) {

    describe('Simple tests', () => {

        test('$eq short syntax // string == string', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq with null value // null == null', () => {
            const qc = new QueryCheck({ myNull: null });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq with null value // string != null', () => {
            const qc = new QueryCheck({ myString: null });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$eq short syntax sub-variable // string == string', () => {
            const qc = new QueryCheck({ "myObject.userName": "maurice" });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax non-existant sub-variable // missing == string throws', () => {
            const qc = new QueryCheck({ "myObject.myUndefined": "some string" });
            qc.setStrictMode(strictMode);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        });

        test('$eq short syntax non-existant sub-variable // missing == string without throwing', () => {
            const qc = new QueryCheck({ "myObject.myUndefined": "some string" });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq short syntax non-existant sub-variable // missing == null without throwing', () => {
            const qc = new QueryCheck({ "myObject.myUndefined": null });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // int[137] == int[137]', () => {
            const qc = new QueryCheck({ myInt: 137 });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // int[137] == string["137"]', () => {
            const qc = new QueryCheck({ myInt: "137" });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$eq short syntax // string["137"] == int[137]', () => {
            const qc = new QueryCheck({ myIntAsString: 137 });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$eq short syntax // float[137.12345] == float[137.12345', () => {
            const qc = new QueryCheck({ myFloat: 137.12345 });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // float[137.12345] == string["137.12345"]', () => {
            const qc = new QueryCheck({ myFloat: "137.12345" });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$eq short syntax // object == object', () => {
            const qc = new QueryCheck({ mySimpleObject: {x: 30, y: 31} });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // string == null', () => {
            const qc = new QueryCheck({ myString: null });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq short syntax // null == ""', () => {
            const qc = new QueryCheck({ myNull: "" });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq short syntax // missing == "" without throwing', () => {
            const qc = new QueryCheck({ myUndefined: "" });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq short syntax // missing == null throws', () => {
            const qc = new QueryCheck({ myUndefined: null });
            qc.setStrictMode(strictMode);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        });

        test('$eq short syntax // missing == null without throwing', () => {
            const qc = new QueryCheck({ myUndefined: null });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // present undefined counts as missing', () => {
            const qc = new QueryCheck({ myUndefined: null });
            qc.setStrictMode(strictMode);
            expect(() => qc.test({ ...vars, myUndefined: undefined })).toThrow(UnknownVariableException);
        });

        test('$eq short syntax // inherited properties are not resolved', () => {
            for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'myLookup.constructor', 'myArrayOfInts.length']) {
                const qc = new QueryCheck({ [name]: { "$ne": null } });
                qc.setStrictMode(strictMode);
                expect(() => qc.test(vars)).toThrow(UnknownVariableException);
            }
        });

        test('$eq short syntax // array[1] == object', () => {
            const qc = new QueryCheck({ "myArrayOfObjects[1]": {x: 20, y: 21} });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // array[1].x == int', () => {
            const qc = new QueryCheck({ "myArrayOfObjects[1].x": 20 });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // array[20] == null without throwing', () => {
            const qc = new QueryCheck({ "myArrayOfObjects[20]": null });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // array[20].a.b.c.d == null without throwing', () => {
            const qc = new QueryCheck({ "myArrayOfObjects[20].a.b.c.d": null });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // myNull.but.this.does.not.exist == null (stops at null)', () => {
            const qc = new QueryCheck({ "myNull.but.this.does.not.exist": null });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq short syntax // myInt.but.this.does.not.exist == null without throwing', () => {
            const qc = new QueryCheck({ "myInt.but.this.does.not.exist": null });
            qc.setStrictMode(strictMode);
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq full syntax // string == different string', () => {
            const qc = new QueryCheck({ myString: { "$eq": "this is a different string" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq full syntax // int == null', () => {
            const qc = new QueryCheck({ myInt: { "$eq": null } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq full syntax // int == null', () => {
            const qc = new QueryCheck({ myInt: { "$eq": null } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq full syntax // array == array', () => {
            const qc = new QueryCheck({ myArrayOfInts: { "$eq": [10, 20, 30, 40, 50] } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq full syntax // array == other array', () => {
            const qc = new QueryCheck({ myArrayOfInts: { "$eq": [17] } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$eq full syntax // array of int == int (included in array)', () => {
            const qc = new QueryCheck({ myArrayOfInts: { "$eq": 30 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq full syntax // array of objects == object (included in array)', () => {
            const qc = new QueryCheck({ myArrayOfObjects: { "$eq": {x: 10, y: 11} } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$eq full syntax // array of strings == string (included in array)', () => {
            const qc = new QueryCheck({ myArrayOfStrings: { "$eq": "vanilla" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });


        test('$in full syntax // int $in array', () => {
            const qc = new QueryCheck({ myInt: { "$in": ["A", "B", 137] } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$in full syntax // int $in array (but int not included)', () => {
            const qc = new QueryCheck({ myInt: { "$in": ["A", "B"] } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$not full syntax // $not { myInt == 138 }', () => {
            const qc = new QueryCheck({ myInt: {"$not": { "$eq": 138 } } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$not full syntax // $not { int $in array (but int not included) }', () => {
            const qc = new QueryCheck({ myInt: {"$not": { "$in": ["A", "B"] } } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$ne full syntax // int != different int', () => {
            const qc = new QueryCheck({ myInt: { "$ne": 138 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$ne full syntax // string != different string', () => {
            const qc = new QueryCheck({ myString: { "$ne": "hello world" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$ne full syntax // int[137] != string["138"]', () => {
            const qc = new QueryCheck({ myInt: {"$ne": "138"} });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(QueryCheck.StrictTypeError);
            }
        });

        test('$ne full syntax // int[137] != string["137"]', () => {
            const qc = new QueryCheck({ myInt: {"$ne": "137"} });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeFalsy();
            } else {
                expect(() => qc.test(vars)).toThrow(QueryCheck.StrictTypeError);
            }
        });

        test('$gt full syntax // int[137] > int[136]', () => {
            const qc = new QueryCheck({ myInt: { "$gt": 136 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$gt full syntax // int[137] > string["136"]', () => {
            const qc = new QueryCheck({ myInt: { "$gt": "136" } });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$gt full syntax // int[137] > int[138]', () => {
            const qc = new QueryCheck({ myInt: { "$gt": 138 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$gt full syntax // int[137] > string["138"]', () => {
            const qc = new QueryCheck({ myInt: { "$gt": "138" } });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).not.toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$lt full syntax // int[137] < int[138]', () => {
            const qc = new QueryCheck({ myInt: { "$lt": 138 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$lt full syntax // int[137] < string["138"]', () => {
            const qc = new QueryCheck({ myInt: { "$lt": "138" } });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$lt full syntax // int[137] < int[136]', () => {
            const qc = new QueryCheck({ myInt: { "$lt": 136 } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$lt full syntax // int[137] < string["136"]', () => {
            const qc = new QueryCheck({ myInt: { "$lt": "136" } });
            qc.setStrictMode(strictMode);
            if (!strictMode) {
                expect(qc.test(vars)).not.toBeTruthy();
            } else {
                expect(() => qc.test(vars)).toThrow(TypeError);
            }
        });

        test('$regex full syntax // string matches other string', () => {
            const qc = new QueryCheck({ myString: { "$regex": "^this is a" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$regex full syntax // string does not match other STRING', () => {
            const qc = new QueryCheck({ myString: { "$regex": "^THIS IS A" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$regex full syntax // string matches other STRING with option case-insensitive', () => {
            const qc = new QueryCheck({ myString: { "$regex": "^THIS IS A", "$options": "i" } });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('test with null input data', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test(null)).toThrow(TypeError);
            } else {
                expect(qc.test(null)).toBeFalsy();
            }
        });

        test('test with non-hash data (array)', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test([])).toThrow(TypeError);
            } else {
                expect(qc.test([])).toBeFalsy();
            }
        });

        test('test with non-hash data (string)', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test("not an object")).toThrow(TypeError);
            } else {
                expect(qc.test("not an object")).toBeFalsy();
            }
        });

        test('test with non-hash data (number)', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test(42)).toThrow(TypeError);
            } else {
                expect(qc.test(42)).toBeFalsy();
            }
        });

        test('test with non-hash data (boolean)', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test(true)).toThrow(TypeError);
            } else {
                expect(qc.test(true)).toBeFalsy();
            }
        });

        test('test with non-hash data (undefined)', () => {
            const qc = new QueryCheck({ myString: "this is a string" });
            qc.setStrictMode(strictMode);
            if (strictMode) {
                expect(() => qc.test(undefined)).toThrow(TypeError);
            } else {
                expect(qc.test(undefined)).toBeFalsy();
            }
        });

    });
}


function combinedTests(strictMode) {

    describe('Combined tests', () => {

        test('ANDed short syntax', () => {
            const qc = new QueryCheck({ myString: "this is a string", myInt: 137 });
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('ANDed full syntax', () => {
            const qc = new QueryCheck({"$and": [{myString: "this is a string"}, {myInt: 137}]});
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('ORed full syntax // true', () => {
            const qc = new QueryCheck({"$or": [{myString: "this is a different string"}, {myInt: 137}]});
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('ORed full syntax // false', () => {
            const qc = new QueryCheck({"$or": [{myString: "this is a different string"}, {myInt: 138}]});
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('AND with sub-OR full syntax', () => {
            const qc = new QueryCheck(
                {"$and": [
                    {"$or": [
                        {myString: "this is a different string"},
                        {myInt: 137}
                    ]},
                    {"$or": [
                        {myBoolTrue: true},
                        {myInt: 138}
                    ]},
                ]}
            );
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('implicit AND with $in, $not, $gt and $lt (opening hours 1)', () => {

            const qc = new QueryCheck(
                {
                    "now.isoDate": {"$in": ["2019-12-25", "2019-12-26", "2019-12-31", "2020-01-01"]},
                    "now.isoTime": {"$not": {"$gt": "10:00", "$lt": "18:00"}}
                }
            );
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();

        });

        test('implicit AND with $in, $not, $gt and $lt (opening hours 2)', () => {

            const qc = new QueryCheck(
                {
                    "now.isoDate": {"$in": ["2019-12-25", "2019-12-26", "2019-12-31", "2020-01-01", "2020-05-21"]},
                    "now.isoTime": {"$not": {"$gt": "10:00", "$lt": "12:00"}}
                }
            );
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();

        });

    });
}


let opEvalFuncs = {
    '$time': timeFunc,
    '$concat': concatFunc,
    '$lookup': lookupFunc,
    '$var': varFunc,
};

function timeFunc(params, data) {
    const dateFns = require('date-fns');

    let result = null;
    let dateLocal = null;

    if (params.date !== undefined) {
        params.date = opEvaluator.apply(this, [params.date, data]);
    }

    if (typeof(params.date) == 'string') {
        if (typeof(params.inputFormat) == 'string' && params.inputFormat != '') {
            dateLocal = dateFns.parse(params.date, params.inputFormat, new Date());
        } else {
            dateLocal = dateFns.parseISO(params.date);
        }
    } else {
        dateLocal = new Date();
    }

    if (params.sub) {
        result = dateFns.sub(dateLocal, params.sub);
    } else if (params.add) {
        result = dateFns.add(dateLocal, params.add);
    } else {
        result = dateLocal;
    }

    if (typeof(params.format) != 'string') {
        // default to ISO 8601 format
        params.format = 'yyyy-MM-dd\'T\'HH:mm:ss';
    }

    if (params.format) {
        result = dateFns.format(result, params.format);
    }

    return result;
}

function concatFunc(params, data) {
    if (!Array.isArray(params)) {
        return '';
    }

    let str = '';
    for (let item of params) {
        str += String(opEvaluator.apply(this, [item, data]));
    }
    return str;
}

function lookupFunc(params, data) {
    params.default = params.default || null;

    if (typeof(params.key) === 'undefined') {
        return params.default;
    }

    params.key = opEvaluator.apply(this, [params.key, data]);

    if (typeof(params.map) === 'undefined' || params.map === null || typeof(params.map) !== 'object') {
        return params.default;
    }

    params.map = opEvaluator.apply(this, [params.map, data]);

    return params.map[params.key] || params.default;
}

function varFunc(params, data) {
    if (typeof(params) == 'string') {
        // shortcut syntax {"$var": "varName"}
        params = {name: params};
    } else if (typeof(params.name) === 'undefined') {
        return undefined;
    }

    return this.getVariableValue(params.name, data);
}

function opEvaluator(operand, data) {
    const isObject = typeof(operand) === 'object' && !Array.isArray(operand) && operand !== null;
    if (!isObject) {
        return operand;
    }

    const firstKey = Object.keys(operand)[0];
    if (firstKey in opEvalFuncs) {
        return opEvalFuncs[firstKey].apply(this, [operand[firstKey], data])
    }

    return operand;
}


function extendingTests(strictMode) {

    describe('Operand evaluator tests', () => {

        test('$time function returns given date', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$time": {"date": "2020-05-21T13:59:48"} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$time function returns given date using different input format', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$time": {"date": "21.05.2020, 13:59:48", "inputFormat": "dd.MM.yyyy, HH:mm:ss"} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$time function returns modified date (-2 days and -3 hours)', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$time": {"date": "2020-05-23T16:59:48", "sub": {"days": 2, "hours": 3}} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$time function cascading (+10 days and -10 days)', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$time": {"date": {"$time": {"date": "2020-05-21T13:59:48", "sub": {"days": 10}}}, "add": {"days": 10}} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$time function cascading (+10 days and -10 days) combined with $var function', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$time": {"date": {"$time": {"date": {"$var": {"name": "now.isoDateTime"}}, "sub": {"days": 10}}}, "add": {"days": 10}} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$concat function with string and $var (all of type string)', () => {
            const qc = new QueryCheck({ "now.isoDateTime": {"$concat": [{"$var": {"name": "now.isoDate"}}, "T", {"$var": {"name": "now.isoTime"}}] }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$concat function with string and $var (with string casting)', () => {
            const qc = new QueryCheck({ "myStringPrime": {"$concat": ["prime", " ", "number", " ", {"$var": {"name": "myInt"}}] }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$lookup function with static map/key (key exists)', () => {
            const qc = new QueryCheck({ "myObject.userName": {"$lookup": {"map": {"this": "is", "a": "lookup", "user": "maurice"}, "key": "user", "default": null} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$lookup function with variable map/key (key exists)', () => {
            const qc = new QueryCheck({ "myObject.userName": {"$lookup": {"map": {"$var": "myLookup"}, "key": {"$var": "lookupKey"}, "default": null} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$lookup function with variable map and static key (where key does not exist)', () => {
            const qc = new QueryCheck({ "myObject.userName": {"$lookup": {"map": {"$var": "myLookup"}, "key": "non-existant"} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).not.toBeTruthy();
        });

        test('$lookup function with variable map and static key (where key does not exist but default matches)', () => {
            const qc = new QueryCheck({ "myObject.userName": {"$lookup": {"map": {"$var": "myLookup"}, "key": "non-existant", "default": "maurice"} }});
            qc.setOperandEvaluator(opEvaluator);
            qc.setStrictMode(strictMode);
            expect(qc.test(vars)).toBeTruthy();
        });

    });
}


function expectSyntaxError(fn, message) {
    expect(fn).toThrow(SyntaxError);
    expect(fn).toThrow(message);
}

function exprTests() {

    describe('$expr aggregation expressions', () => {

        test('$expr with $gt and $add // (field1 + field2) > 10', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$gt': [
                        {'$add': ['$myInt', '$myFloat']},
                        200
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr compare two fields // spent > budget', () => {
            const data = {spent: 450, budget: 400};
            const qc = new QueryCheck({
                '$expr': {
                    '$gt': ['$spent', '$budget']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $subtract // (price - discount) < 100', () => {
            const data = {price: 100, discount: 20};
            const qc = new QueryCheck({
                '$expr': {
                    '$lt': [
                        {'$subtract': ['$price', '$discount']},
                        90
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $multiply // (field1 * field2) >= 35', () => {
            const data = {field1: 5, field2: 7};
            const qc = new QueryCheck({
                '$expr': {
                    '$gte': [
                        {'$multiply': ['$field1', '$field2']},
                        35
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $divide // (field1 / field2) == 2', () => {
            const data = {field1: 10, field2: 5};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$divide': ['$field1', '$field2']},
                        2
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $mod // (field1 % field2) == 2', () => {
            const data = {field1: 17, field2: 5};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$mod': ['$field1', '$field2']},
                        2
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $cond // conditional discount calculation', () => {
            const data = {qty: 150, price: 100};
            const qc = new QueryCheck({
                '$expr': {
                    '$lt': [
                        {
                            '$cond': {
                                'if': {'$gte': ['$qty', 100]},
                                'then': {'$multiply': ['$price', 0.5]},
                                'else': {'$multiply': ['$price', 0.75]}
                            }
                        },
                        60
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with complex nested expression', () => {
            const data = {field1: 5, field2: 7};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$add': [
                            {'$multiply': ['$field1', 2]},
                            {'$subtract': ['$field2', 3]}
                        ]},
                        14
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $ne // field1 != field2', () => {
            const data = {field1: 5, field2: 7};
            const qc = new QueryCheck({
                '$expr': {
                    '$ne': ['$field1', '$field2']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $lte // field1 <= field2', () => {
            const data = {field1: 5, field2: 5};
            const qc = new QueryCheck({
                '$expr': {
                    '$lte': ['$field1', '$field2']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr returns false when condition not met', () => {
            const data = {field1: 5, field2: 7};
            const qc = new QueryCheck({
                '$expr': {
                    '$gt': [
                        {'$add': ['$field1', '$field2']},
                        20
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with operandEvaluator for custom $var resolution', () => {
            const data = {price: 100, multiplier: 2};
            const qc = new QueryCheck({
                '$expr': {
                    '$gt': [
                        {'$multiply': [{'$var': 'price'}, {'$var': 'multiplier'}]},
                        150
                    ]
                }
            });

            const varFunc = function (params, input) {
                if (params && typeof params === 'object' && !Array.isArray(params) && params['$var'] !== undefined) {
                    return qc.getVariableValue(params['$var'], input);
                }
                return params;
            };

            qc.setOperandEvaluator(varFunc);
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $add treats field names without $ as literal strings', () => {
            const data = {field1: 10, field2: 20};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$add': ['field1', 5]},
                        'field15'
                    ]
                }
            });
            qc.setStrictMode(false);
            expectSyntaxError(() => qc.test(data), '$add operands must be numeric');
        });

        test('$expr with $add using correct $field syntax works', () => {
            const data = {field1: 10, field2: 20};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$add': ['$field1', '$field2']},
                        30
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr combined with regular field queries using $and', () => {
            const data = {
                category: 'electronics',
                price: 100,
                discount: 20,
                inStock: true
            };
            const qc = new QueryCheck({
                '$and': [
                    {category: 'electronics'},
                    {inStock: true},
                    {
                        '$expr': {
                            '$lt': [
                                {'$subtract': ['$price', '$discount']},
                                90
                            ]
                        }
                    }
                ]
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr combined with $and returns false when expression fails', () => {
            const data = {
                category: 'electronics',
                price: 100,
                discount: 10,
                inStock: true
            };
            const qc = new QueryCheck({
                '$and': [
                    {category: 'electronics'},
                    {inStock: true},
                    {
                        '$expr': {
                            '$lt': [
                                {'$subtract': ['$price', '$discount']},
                                90
                            ]
                        }
                    }
                ]
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $not // $not[true] returns false', () => {
            const qc = new QueryCheck({'$expr': {'$not': [true]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $not // $not[false] returns true', () => {
            const qc = new QueryCheck({'$expr': {'$not': [false]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $not // $not[null] returns true', () => {
            const qc = new QueryCheck({'$expr': {'$not': [null]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $not // $not[0] returns true', () => {
            const qc = new QueryCheck({'$expr': {'$not': [0]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $not // $not[0.0] returns true (float zero is falsy in MongoDB)', () => {
            const qc = new QueryCheck({'$expr': {'$not': [0.0]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $not // $not[1] returns false', () => {
            const qc = new QueryCheck({'$expr': {'$not': [1]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $not // $not[137] returns false', () => {
            const qc = new QueryCheck({'$expr': {'$not': [137]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $not // $not[[false]] returns false (array is truthy)', () => {
            const qc = new QueryCheck({'$expr': {'$not': [[false]]}});
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $not // $not[$gt[$qty, 250]]', () => {
            const data = {qty: 200};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$gt': ['$qty', 250]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not // $not[$gt[$qty, 250]] returns false when qty > 250', () => {
            const data = {qty: 300};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$gt': ['$qty', 250]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $not // $not[$eq[field1, field2]] when fields are equal', () => {
            const data = {field1: 100, field2: 100};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$eq': ['$field1', '$field2']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $not // $not[$eq[field1, field2]] when fields are not equal', () => {
            const data = {field1: 100, field2: 200};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$eq': ['$field1', '$field2']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not // $not[$eq[field, literal]] when equal', () => {
            const data = {status: 'active'};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$eq': ['$status', 'active']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $not // $not[$eq[field, literal]] when not equal', () => {
            const data = {status: 'inactive'};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$eq': ['$status', 'active']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $in // value in array returns true', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['banana', ['apple', 'banana', 'cherry']]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $in // value not in array returns false', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['orange', ['apple', 'banana', 'cherry']]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $in // field value in array', () => {
            const data = {fruit: 'banana', in_stock: ['apple', 'banana', 'cherry']};
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['$fruit', '$in_stock']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $in // field value not in array', () => {
            const data = {fruit: 'orange', in_stock: ['apple', 'banana', 'cherry']};
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['$fruit', '$in_stock']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $in // number in array', () => {
            const data = {value: 137};
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['$value', [100, 137, 200]]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $in // null in array', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$in': [null, [1, 2, null, 3]]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $in // empty array returns false', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['banana', '$myEmptyArray']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeFalsy();
        });

        test('$expr with $in // object in array of objects', () => {
            const data = {
                item: {x: 10, y: 11},
                items: [{x: 10, y: 11}, {x: 20, y: 21}]
            };
            const qc = new QueryCheck({
                '$expr': {
                    '$in': ['$item', '$items']
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not and $in // $not[$in[value, array]]', () => {
            const data = {fruit: 'orange', in_stock: ['apple', 'banana', 'cherry']};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': ['$fruit', '$in_stock']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not and $in // $not[$in[value, array]] returns false when value is in array', () => {
            const data = {fruit: 'banana', in_stock: ['apple', 'banana', 'cherry']};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': ['$fruit', '$in_stock']}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $not and $in // $not[$in[literal, literal array]]', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': ['grape', ['apple', 'banana', 'cherry']]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr with $not and $in // $not[$in[number, number array]]', () => {
            const data = {value: 42};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': ['$value', [10, 20, 30, 40]]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not and $in // $not[$in[computed value, array]]', () => {
            const data = {price: 100, discount: 30, invalid_prices: [50, 60, 80]};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': [
                            {'$subtract': ['$price', '$discount']},
                            '$invalid_prices'
                        ]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $not and $in // $not[$in[computed value, array]] returns false when value is in array', () => {
            const data = {price: 100, discount: 20, invalid_prices: [50, 60, 80]};
            const qc = new QueryCheck({
                '$expr': {
                    '$not': [
                        {'$in': [
                            {'$subtract': ['$price', '$discount']},
                            '$invalid_prices'
                        ]}
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeFalsy();
        });

        test('$expr with $in and comparison // check if discounted price is in valid range', () => {
            const data = {price: 100, discount: 20, valid_prices: [50, 80, 100, 150]};
            const qc = new QueryCheck({
                '$expr': {
                    '$in': [
                        {'$subtract': ['$price', '$discount']},
                        '$valid_prices'
                    ]
                }
            });
            qc.setStrictMode(false);
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // returns array length', () => {
            const data = {colors: ['blue', 'black', 'red']};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$size': '$colors'}, 3]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // empty array returns 0', () => {
            const data = {colors: []};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$size': '$colors'}, 0]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // use with $gt for minimum elements', () => {
            const data = {tags: ['php', 'mongodb', 'querycheck', 'testing']};
            const qc = new QueryCheck({
                '$expr': {
                    '$gt': [{'$size': '$tags'}, 3]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // use with $lt for maximum elements', () => {
            const data = {items: ['a', 'b']};
            const qc = new QueryCheck({
                '$expr': {
                    '$lt': [{'$size': '$items'}, 5]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // use with $gte', () => {
            const data = {items: ['x', 'y', 'z']};
            const qc = new QueryCheck({
                '$expr': {
                    '$gte': [{'$size': '$items'}, 3]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // throws on non-array', () => {
            const data = {name: 'John'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$size': '$name'}, 4]
                }
            });
            expectSyntaxError(() => qc.test(data), '$size: argument must resolve to an array');
        });

        test('$expr with $size // throws on associative array (object)', () => {
            const data = {data: {x: 1, y: 2}};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$size': '$data'}, 2]
                }
            });
            expectSyntaxError(() => qc.test(data), '$size: argument must resolve to an array');
        });

        test('$expr with $size // combined with $cond', () => {
            const data = {items: ['a', 'b', 'c', 'd', 'e']};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$cond': {
                            'if': {'$gte': [{'$size': '$items'}, 5]},
                            'then': 'bulk',
                            'else': 'single'
                        }},
                        'bulk'
                    ]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $size // with literal array', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$size': [1, 2, 3, 4]}, 4]
                }
            });
            expect(qc.test({dummy: 'value'})).toBeTruthy();
        });

        test('$expr with array index access // $myArray[0] and $myList[0].amount', () => {
            const data = {
                myArray: [10, 20, 30],
                myList: [
                    {amount: 100, name: 'first'},
                    {amount: 200, name: 'second'}
                ]
            };

            let qc = new QueryCheck({
                '$expr': {
                    '$eq': ['$myArray[0]', 10]
                }
            });
            expect(qc.test(data)).toBeTruthy();

            qc = new QueryCheck({
                '$expr': {
                    '$eq': ['$myList[0].amount', 100]
                }
            });
            expect(qc.test(data)).toBeTruthy();

            qc = new QueryCheck({
                '$expr': {
                    '$lt': ['$myList[0].amount', '$myList[1].amount']
                }
            });
            expect(qc.test(data)).toBeTruthy();

            qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$add': ['$myArray[0]', '$myArray[1]']},
                        30
                    ]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with deeply nested array index access // $myObj.sub1.sub2.myList[0].amount', () => {
            const data = {
                myObj: {
                    sub1: {
                        sub2: {
                            myList: [
                                {amount: 42, name: 'first'},
                                {amount: 99, name: 'second'}
                            ]
                        }
                    }
                }
            };

            let qc = new QueryCheck({
                '$expr': {
                    '$eq': ['$myObj.sub1.sub2.myList[0].amount', 42]
                }
            });
            expect(qc.test(data)).toBeTruthy();

            qc = new QueryCheck({
                '$expr': {
                    '$eq': ['$myObj.sub1.sub2.myList[1].name', 'second']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $and // check $size >= 1 before accessing myList[0]', () => {
            const data = {
                myList: [
                    {amount: 100, name: 'first'}
                ]
            };
            const qc = new QueryCheck({
                '$and': [
                    {'$expr': {'$gte': [{'$size': '$myList'}, 1]}},
                    {'$expr': {'$eq': ['$myList[0].amount', 100]}}
                ]
            });
            expect(qc.test(data)).toBeTruthy();

            // Short-circuits on the first condition and never accesses myList[0].
            expect(qc.test({myList: []})).toBeFalsy();
        });

        test('$expr with $toLower // converts string to lowercase', () => {
            const data = {name: 'JOHN DOE'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$toLower': '$name'}, 'john doe']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $toUpper // converts string to uppercase', () => {
            const data = {name: 'john doe'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$toUpper': '$name'}, 'JOHN DOE']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $toLower // case-insensitive comparison of two fields', () => {
            const data = {field1: 'Hello World', field2: 'HELLO WORLD'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [
                        {'$toLower': '$field1'},
                        {'$toLower': '$field2'}
                    ]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $toLower // handles unicode characters', () => {
            const data = {name: 'MÜLLER'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$toLower': '$name'}, 'müller']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $toUpper // throws on non-string', () => {
            const data = {value: 123};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$toUpper': '$value'}, '123']
                }
            });
            expectSyntaxError(() => qc.test(data), '$toUpper: argument must resolve to a string');
        });

        test('$expr with $substr // extracts substring by codepoint', () => {
            const data = {text: 'Hello World'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$substr': ['$text', 0, 5]}, 'Hello']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $substr // handles unicode codepoints', () => {
            const data = {text: 'Müller'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$substr': ['$text', 0, 3]}, 'Mül']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $substr // negative length returns rest of string', () => {
            const data = {text: 'Hello World'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$substr': ['$text', 6, -1]}, 'World']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $substrBytes // extracts substring by bytes', () => {
            const data = {text: 'Hello World'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$substrBytes': ['$text', 0, 5]}, 'Hello']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $substrBytes // byte-based on multibyte string', () => {
            const data = {text: 'Müller'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$substrBytes': ['$text', 0, 1]}, 'M']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $strLenBytes // returns byte length', () => {
            const data = {text: 'Hello'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$strLenBytes': '$text'}, 5]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $strLenBytes // counts bytes for multibyte chars', () => {
            const data = {text: 'Müller'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$strLenBytes': '$text'}, 7]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $strLenCP // returns codepoint length', () => {
            const data = {text: 'Hello'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$strLenCP': '$text'}, 5]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $strLenCP // counts codepoints for multibyte chars', () => {
            const data = {text: 'Müller'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$strLenCP': '$text'}, 6]
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $trim // removes whitespace from both ends', () => {
            const data = {text: '  hello  '};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$trim': {input: '$text'}}, 'hello']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $trim // removes specified chars', () => {
            const data = {text: '---hello---'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$trim': {input: '$text', chars: '-'}}, 'hello']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $ltrim // removes whitespace from left', () => {
            const data = {text: '  hello  '};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$ltrim': {input: '$text'}}, 'hello  ']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $rtrim // removes whitespace from right', () => {
            const data = {text: '  hello  '};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$rtrim': {input: '$text'}}, '  hello']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $concat // concatenates strings', () => {
            const data = {first: 'Hello', second: 'World'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$concat': ['$first', ' ', '$second']}, 'Hello World']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $concat // concatenates multiple strings', () => {
            const data = {a: 'a', b: 'b', c: 'c'};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$concat': ['$a', '$b', '$c']}, 'abc']
                }
            });
            expect(qc.test(data)).toBeTruthy();
        });

        test('$expr with $concat // throws on non-string', () => {
            const data = {text: 'hello', num: 123};
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': [{'$concat': ['$text', '$num']}, 'hello123']
                }
            });
            expectSyntaxError(() => qc.test(data), '$concat: all arguments must resolve to strings');
        });

    });
}


function unknownVariableTests() {

    describe('Throw on unknown variable', () => {

        test('missing variable throws UnknownVariableException when enabled', () => {
            const qc = new QueryCheck({ myUndefined: null });
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
            expect(() => qc.test(vars)).toThrow("Variable 'myUndefined' is not defined");
        });

        test('missing nested variable throws when enabled', () => {
            const qc = new QueryCheck({ "myObject.myUndefined": "some string" });
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
            expect(() => qc.test(vars)).toThrow("Variable 'myObject.myUndefined' is not defined");
        });

        test('missing array index throws when enabled', () => {
            const qc = new QueryCheck({ "myArrayOfObjects[20]": null });
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        });

        test('path through a non-object throws when enabled', () => {
            const qc = new QueryCheck({ "myInt.but.this.does.not.exist": null });
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        });

        test('existing null is not an unknown variable', () => {
            const qc = new QueryCheck({ myNull: null });
            qc.setThrowOnUnknownVariable(true);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('path through an existing null does not throw', () => {
            const qc = new QueryCheck({ "myNull.but.this.does.not.exist": null });
            qc.setThrowOnUnknownVariable(true);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('setUndefinedEqualsNull was removed', () => {
            const qc = new QueryCheck({ myUndefined: null });
            expect(qc.setUndefinedEqualsNull).toBeUndefined();
        });

        test('enabled by default, missing variable throws', () => {
            const qc = new QueryCheck({ myUndefined: null });
            expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        });

        test('disabled, missing variable equals null', () => {
            const qc = new QueryCheck({ myUndefined: null });
            qc.setThrowOnUnknownVariable(false);
            expect(qc.test(vars)).toBeTruthy();
        });

        test('$expr missing field throws when enabled', () => {
            const qc = new QueryCheck({
                '$expr': {
                    '$eq': ['$missing', 1]
                }
            });
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.test({ other: 1 })).toThrow(UnknownVariableException);
            expect(() => qc.test({ other: 1 })).toThrow("Variable 'missing' is not defined");
        });

        test('getVariableValue throws when enabled', () => {
            const qc = new QueryCheck({});
            qc.setThrowOnUnknownVariable(true);
            expect(() => qc.getVariableValue('missing', { other: 1 })).toThrow(UnknownVariableException);
        });

    });
}


describe('Testing in STANDARD mode', () => {
    simpleTests(false);
    combinedTests(false);
    extendingTests(false);
});

describe('Testing in STRICT mode', () => {
    simpleTests(true);
    combinedTests(true);
    extendingTests(true);
});

exprTests();
unknownVariableTests();

/**/
