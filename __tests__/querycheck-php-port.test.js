'use strict';

// Port of querycheck-php/tests/QueryCheckTest.php (PHP v2.0.0, reference).

const dateFns = require('date-fns');
const QueryCheck = require('../src/querycheck');

const { SyntaxError: QuerySyntaxError, StrictTypeError, UnknownVariableException } = QueryCheck;

function makeVars() {
    return {
        now: {
            isWeekday: true,
            isHoliday: false,
            isoDate: '2020-05-21',
            isoTime: '13:59:48',
            isoDateTime: '2020-05-21T13:59:48',
        },
        myString: 'this is a string',
        myStringFlavor: 'strawberry',
        myStringPrime: 'prime number 137',
        myInt: 137,
        myIntAsString: '137',
        myFloat: 137.12345,
        myBoolTrue: true,
        myBoolFalse: false,
        myNull: null,
        myArrayOfInts: [10, 20, 30, 40, 50],
        myArrayOfStrings: ['vanilla', 'strawberry', 'chocolate'],
        myArrayOfObjects: [{ x: 10, y: 11 }, { x: 20, y: 21 }, { x: 40, y: 41 }],
        mySimpleObject: { x: 30, y: 31 },
        myLookup: {
            0: 'zero',
            '1': 'one',
            user: 'maurice',
        },
        lookupKey: 'user',
        myObject: {
            userName: 'maurice',
            firstName: 'First',
            lastName: 'Last',
        },
        myEmptyArray: [],
    };
}

let vars;
beforeEach(() => {
    vars = makeVars();
});

/**
 * @param {any} query
 * @param {boolean} [strict]
 */
function qcOf(query, strict = false) {
    const qc = new QueryCheck(query);
    qc.setStrictMode(strict);
    return qc;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createOpEvaluator(qc) {
    let opEvaluator = (operand) => operand;

    const concatFunc = (params, data) => {
        if (!Array.isArray(params)) {
            return '';
        }
        let str = '';
        for (const item of params) {
            str += String(opEvaluator(item, data));
        }
        return str;
    };

    const lookupFunc = (params, data) => {
        const def = params.default ?? null;
        if (params.key === undefined || params.key === null) {
            return def;
        }
        const key = opEvaluator(params.key, data);
        if (!isObject(params.map)) {
            return def;
        }
        const map = opEvaluator(params.map, data);
        return isObject(map) && Object.hasOwn(map, key) ? (map[key] ?? def) : def;
    };

    const varFunc = (params, data) => {
        if (typeof params === 'string') {
            params = { name: params };
        } else if (params === null || params.name === undefined || params.name === null) {
            return null;
        }
        return qc.getVariableValue(params.name, data);
    };

    const timeFunc = (params, data) => {
        params = isObject(params) ? { ...params } : {};
        if (Object.hasOwn(params, 'date')) {
            params.date = opEvaluator(params.date, data);
        }

        let dateLocal;
        if (typeof params.date === 'string') {
            const inputFormat = params.inputFormat ?? '';
            if (typeof inputFormat === 'string' && inputFormat !== '') {
                dateLocal = dateFns.parse(params.date, inputFormat, new Date());
                if (!dateFns.isValid(dateLocal)) {
                    throw new Error('Unable to parse date: ' + params.date);
                }
            } else {
                dateLocal = dateFns.parseISO(params.date);
            }
        } else {
            dateLocal = new Date();
        }

        if (isObject(params.sub)) {
            dateLocal = dateFns.sub(dateLocal, params.sub);
        } else if (isObject(params.add)) {
            dateLocal = dateFns.add(dateLocal, params.add);
        }

        const format = typeof params.format === 'string' ? params.format : "yyyy-MM-dd'T'HH:mm:ss";
        return dateFns.format(dateLocal, format);
    };

    const opEvalFuncs = {
        '$time': timeFunc,
        '$concat': concatFunc,
        '$lookup': lookupFunc,
        '$var': varFunc,
    };

    opEvaluator = (operand, data) => {
        if (!isObject(operand)) {
            return operand;
        }
        const firstKey = Object.keys(operand)[0];
        if (firstKey !== undefined && Object.hasOwn(opEvalFuncs, firstKey)) {
            return opEvalFuncs[firstKey](operand[firstKey], data);
        }
        return operand;
    };

    return opEvaluator;
}

// STANDARD MODE TESTS

describe('standard mode', () => {
    test('testEqShortSyntaxStringEqualsString: $eq short syntax // string == string', () => {
        expect(qcOf({ myString: 'this is a string' }).test(vars)).toBe(true);
    });

    test('testEqWithNullValueNullEqualsNull: $eq with null value // null == null', () => {
        expect(qcOf({ myNull: null }).test(vars)).toBe(true);
    });

    test('testEqWithNullValueStringNotEqualsNull: $eq with null value // string != null', () => {
        expect(qcOf({ myString: null }).test(vars)).toBe(false);
    });

    test('testEqShortSyntaxSubVariableStringEqualsString: $eq short syntax sub-variable // string == string', () => {
        expect(qcOf({ 'myObject.userName': 'maurice' }).test(vars)).toBe(true);
    });

    test('testThrowOnUnknownVariableCanBeDisabled: setThrowOnUnknownVariable(false) does not throw and missing compares as null', () => {
        let qc = new QueryCheck({ myUndefined: 'some string' });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(false);

        qc = new QueryCheck({ myUndefined: null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testThrowOnUnknownVariableCanBeEnabled: setThrowOnUnknownVariable(true) throws UnknownVariableException', () => {
        const qc = new QueryCheck({ 'myObject.myUndefined': 'some string' });
        qc.setThrowOnUnknownVariable(true);
        expect(() => qc.test(vars)).toThrow(UnknownVariableException);
        expect(() => qc.test(vars)).toThrow("Variable 'myObject.myUndefined' is not defined");
    });

    test('testExprMissingFieldDoesNotThrowWhenDisabled: $expr missing field does not throw when setThrowOnUnknownVariable(false)', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': ['$missing', null] } });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test({ other: 1 })).toBe(true);
    });

    test('testEqShortSyntaxNonExistantSubVariableUndefinedThrowsException: $eq short syntax non-existant sub-variable // undefined throws exception', () => {
        const qc = qcOf({ 'myObject.myUndefined': 'some string' });
        expect(() => qc.test(vars)).toThrow(UnknownVariableException);
    });

    test('testEqShortSyntaxNonExistantSubVariableUndefinedIsNullWhenNotThrowing: $eq short syntax non-existant sub-variable // undefined == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myObject.myUndefined': null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqShortSyntaxIntEqualsInt: $eq short syntax // int[137] == int[137]', () => {
        expect(qcOf({ myInt: 137 }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxIntEqualsString: $eq short syntax // int[137] == string["137"]', () => {
        expect(qcOf({ myInt: '137' }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxStringEqualsInt: $eq short syntax // string["137"] == int[137]', () => {
        expect(qcOf({ myIntAsString: 137 }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxFloatEqualsFloat: $eq short syntax // float[137.12345] == float[137.12345]', () => {
        expect(qcOf({ myFloat: 137.12345 }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxFloatEqualsString: $eq short syntax // float[137.12345] == string["137.12345"]', () => {
        expect(qcOf({ myFloat: '137.12345' }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxObjectEqualsObject: $eq short syntax // object == object', () => {
        expect(qcOf({ mySimpleObject: { x: 30, y: 31 } }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxStringNotEqualsNull: $eq short syntax // string != null', () => {
        expect(qcOf({ myString: null }).test(vars)).toBe(false);
    });

    test('testEqShortSyntaxNullNotEqualsEmptyString: $eq short syntax // null != ""', () => {
        expect(qcOf({ myNull: '' }).test(vars)).toBe(false);
    });

    test('testEqShortSyntaxUndefinedThrowsException: $eq short syntax // undefined throws exception', () => {
        const qc = qcOf({ myUndefined: '' });
        expect(() => qc.test(vars)).toThrow(UnknownVariableException);
    });

    test('testEqShortSyntaxUndefinedIsNullWhenNotThrowing: $eq short syntax // undefined == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ myUndefined: null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqShortSyntaxArrayIndexEqualsObject: $eq short syntax // array[1] == object', () => {
        expect(qcOf({ 'myArrayOfObjects[1]': { x: 20, y: 21 } }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxArrayIndexPropertyEqualsInt: $eq short syntax // array[1].x == int', () => {
        expect(qcOf({ 'myArrayOfObjects[1].x': 20 }).test(vars)).toBe(true);
    });

    test('testEqShortSyntaxArrayOutOfBoundsEqualsNullWithFlag: $eq short syntax // array[20] == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myArrayOfObjects[20]': null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqShortSyntaxArrayDeepNonExistantEqualsNullWithFlag: $eq short syntax // array[20].a.b.c.d == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myArrayOfObjects[20].a.b.c.d': null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqShortSyntaxNullPropertyNonExistantEqualsNullWithFlag: $eq short syntax // myNull.but.this.does.not.exist == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myNull.but.this.does.not.exist': null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqShortSyntaxIntPropertyNonExistantEqualsNullWithFlag: $eq short syntax // myInt.but.this.does.not.exist == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myInt.but.this.does.not.exist': null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testEqFullSyntaxStringNotEqualsDifferentString: $eq full syntax // string != different string', () => {
        expect(qcOf({ myString: { '$eq': 'this is a different string' } }).test(vars)).toBe(false);
    });

    test('testEqFullSyntaxIntNotEqualsNull: $eq full syntax // int != null', () => {
        expect(qcOf({ myInt: { '$eq': null } }).test(vars)).toBe(false);
    });

    test('testEqFullSyntaxArrayEqualsArray: $eq full syntax // array == array', () => {
        expect(qcOf({ myArrayOfInts: { '$eq': [10, 20, 30, 40, 50] } }).test(vars)).toBe(true);
    });

    test('testEqFullSyntaxArrayNotEqualsOtherArray: $eq full syntax // array != other array', () => {
        expect(qcOf({ myArrayOfInts: { '$eq': [17] } }).test(vars)).toBe(false);
    });

    test('testEqFullSyntaxArrayOfIntEqualsIntIncludedInArray: $eq full syntax // array of int == int (included in array)', () => {
        expect(qcOf({ myArrayOfInts: { '$eq': 30 } }).test(vars)).toBe(true);
    });

    test('testEqFullSyntaxArrayOfObjectsEqualsObjectIncludedInArray: $eq full syntax // array of objects == object (included in array)', () => {
        expect(qcOf({ myArrayOfObjects: { '$eq': { x: 10, y: 11 } } }).test(vars)).toBe(true);
    });

    test('testEqFullSyntaxArrayOfStringsEqualsStringIncludedInArray: $eq full syntax // array of strings == string (included in array)', () => {
        expect(qcOf({ myArrayOfStrings: { '$eq': 'vanilla' } }).test(vars)).toBe(true);
    });

    test('testInFullSyntaxIntInArray: $in full syntax // int $in array', () => {
        expect(qcOf({ myInt: { '$in': ['A', 'B', 137] } }).test(vars)).toBe(true);
    });

    test('testInFullSyntaxIntNotInArray: $in full syntax // int $in array (but int not included)', () => {
        expect(qcOf({ myInt: { '$in': ['A', 'B'] } }).test(vars)).toBe(false);
    });

    test('testNotFullSyntaxNotIntEquals138: $not full syntax // $not { myInt == 138 }', () => {
        expect(qcOf({ myInt: { '$not': { '$eq': 138 } } }).test(vars)).toBe(true);
    });

    test('testNotFullSyntaxNotIntInArray: $not full syntax // $not { int $in array (but int not included) }', () => {
        expect(qcOf({ myInt: { '$not': { '$in': ['A', 'B'] } } }).test(vars)).toBe(true);
    });

    test('testNeFullSyntaxIntNotEqualsDifferentInt: $ne full syntax // int != different int', () => {
        expect(qcOf({ myInt: { '$ne': 138 } }).test(vars)).toBe(true);
    });

    test('testNeFullSyntaxStringNotEqualsDifferentString: $ne full syntax // string != different string', () => {
        expect(qcOf({ myString: { '$ne': 'hello world' } }).test(vars)).toBe(true);
    });

    test('testNeFullSyntaxIntNotEqualsString138: $ne full syntax // int[137] != string["138"]', () => {
        expect(qcOf({ myInt: { '$ne': '138' } }).test(vars)).toBe(true);
    });

    test('testNeFullSyntaxIntNotEqualsString137: $ne full syntax // int[137] != string["137"]', () => {
        expect(qcOf({ myInt: { '$ne': '137' } }).test(vars)).toBe(false);
    });

    test('testGtFullSyntaxIntGreaterThan136: $gt full syntax // int[137] > int[136]', () => {
        expect(qcOf({ myInt: { '$gt': 136 } }).test(vars)).toBe(true);
    });

    test('testGtFullSyntaxIntGreaterThanString136: $gt full syntax // int[137] > string["136"]', () => {
        expect(qcOf({ myInt: { '$gt': '136' } }).test(vars)).toBe(true);
    });

    test('testGtFullSyntaxIntNotGreaterThan138: $gt full syntax // int[137] > int[138]', () => {
        expect(qcOf({ myInt: { '$gt': 138 } }).test(vars)).toBe(false);
    });

    test('testGtFullSyntaxIntNotGreaterThanString138: $gt full syntax // int[137] > string["138"]', () => {
        expect(qcOf({ myInt: { '$gt': '138' } }).test(vars)).toBe(false);
    });

    test('testLtFullSyntaxIntLessThan138: $lt full syntax // int[137] < int[138]', () => {
        expect(qcOf({ myInt: { '$lt': 138 } }).test(vars)).toBe(true);
    });

    test('testLtFullSyntaxIntLessThanString138: $lt full syntax // int[137] < string["138"]', () => {
        expect(qcOf({ myInt: { '$lt': '138' } }).test(vars)).toBe(true);
    });

    test('testLtFullSyntaxIntNotLessThan136: $lt full syntax // int[137] < int[136]', () => {
        expect(qcOf({ myInt: { '$lt': 136 } }).test(vars)).toBe(false);
    });

    test('testLtFullSyntaxIntNotLessThanString136: $lt full syntax // int[137] < string["136"]', () => {
        expect(qcOf({ myInt: { '$lt': '136' } }).test(vars)).toBe(false);
    });

    test('testRegexFullSyntaxStringMatches: $regex full syntax // string matches other string', () => {
        expect(qcOf({ myString: { '$regex': '^this is a' } }).test(vars)).toBe(true);
    });

    test('testRegexFullSyntaxStringDoesNotMatchUppercase: $regex full syntax // string does not match other STRING', () => {
        expect(qcOf({ myString: { '$regex': '^THIS IS A' } }).test(vars)).toBe(false);
    });

    test('testRegexFullSyntaxStringMatchesCaseInsensitive: $regex full syntax // string matches other STRING with option case-insensitive', () => {
        expect(qcOf({ myString: { '$regex': '^THIS IS A', '$options': 'i' } }).test(vars)).toBe(true);
    });

    test.each([
        ['testWithNullInputData', 'null input data', null],
        ['testWithNonHashDataArray', 'non-hash data (array)', []],
        ['testWithNonHashDataString', 'non-hash data (string)', 'not an object'],
        ['testWithNonHashDataNumber', 'non-hash data (number)', 42],
        ['testWithNonHashDataBoolean', 'non-hash data (boolean)', true],
    ])('%s: test with %s', (_name, _desc, data) => {
        expect(qcOf({ myString: 'this is a string' }).test(data)).toBe(false);
    });

    test('testAndedShortSyntax: ANDed short syntax', () => {
        expect(qcOf({ myString: 'this is a string', myInt: 137 }).test(vars)).toBe(true);
    });

    test('testAndedFullSyntax: ANDed full syntax', () => {
        expect(qcOf({ '$and': [{ myString: 'this is a string' }, { myInt: 137 }] }).test(vars)).toBe(true);
    });

    test('testOredFullSyntaxTrue: ORed full syntax // true', () => {
        expect(qcOf({ '$or': [{ myString: 'this is a different string' }, { myInt: 137 }] }).test(vars)).toBe(true);
    });

    test('testOredFullSyntaxFalse: ORed full syntax // false', () => {
        expect(qcOf({ '$or': [{ myString: 'this is a different string' }, { myInt: 138 }] }).test(vars)).toBe(false);
    });

    test('testAndWithSubOrFullSyntax: AND with sub-OR full syntax', () => {
        const qc = qcOf({
            '$and': [
                { '$or': [{ myString: 'this is a different string' }, { myInt: 137 }] },
                { '$or': [{ myBoolTrue: true }, { myInt: 138 }] },
            ],
        });
        expect(qc.test(vars)).toBe(true);
    });

    test('testImplicitAndOpeningHours1: implicit AND with $in, $not, $gt and $lt (opening hours 1)', () => {
        const qc = qcOf({
            'now.isoDate': { '$in': ['2019-12-25', '2019-12-26', '2019-12-31', '2020-01-01'] },
            'now.isoTime': { '$not': { '$gt': '10:00', '$lt': '18:00' } },
        });
        expect(qc.test(vars)).toBe(false);
    });

    test('testImplicitAndOpeningHours2: implicit AND with $in, $not, $gt and $lt (opening hours 2)', () => {
        const qc = qcOf({
            'now.isoDate': { '$in': ['2019-12-25', '2019-12-26', '2019-12-31', '2020-01-01', '2020-05-21'] },
            'now.isoTime': { '$not': { '$gt': '10:00', '$lt': '12:00' } },
        });
        expect(qc.test(vars)).toBe(true);
    });
});

// STRICT MODE TESTS

describe('strict mode', () => {
    test('testStrictEqShortSyntaxNonExistantSubVariableUndefinedThrowsException: [STRICT] $eq short syntax non-existant sub-variable // undefined throws exception', () => {
        const qc = qcOf({ 'myObject.myUndefined': 'some string' }, true);
        expect(() => qc.test(vars)).toThrow(UnknownVariableException);
    });

    test('testStrictEqShortSyntaxNonExistantSubVariableUndefinedIsNullWhenNotThrowing: [STRICT] $eq short syntax non-existant sub-variable // undefined == null with setThrowOnUnknownVariable(false)', () => {
        const qc = qcOf({ 'myObject.myUndefined': null }, true);
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test(vars)).toBe(true);
    });

    test('testStrictEqShortSyntaxIntEqualsString: [STRICT] $eq short syntax // int[137] == string["137"]', () => {
        const qc = qcOf({ myInt: '137' }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
    });

    test('testStrictEqShortSyntaxStringEqualsInt: [STRICT] $eq short syntax // string["137"] == int[137]', () => {
        const qc = qcOf({ myIntAsString: 137 }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
    });

    test('testStrictEqShortSyntaxFloatEqualsString: [STRICT] $eq short syntax // float[137.12345] == string["137.12345"]', () => {
        const qc = qcOf({ myFloat: '137.12345' }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
    });

    test('testStrictEqShortSyntaxUndefinedThrowsException: [STRICT] $eq short syntax // undefined throws exception', () => {
        const qc = qcOf({ myUndefined: '' }, true);
        expect(() => qc.test(vars)).toThrow(UnknownVariableException);
    });

    test('testStrictNeFullSyntaxIntNotEqualsString138: [STRICT] $ne full syntax // int[137] != string["138"] throws, like $eq', () => {
        const qc = qcOf({ myInt: { '$ne': '138' } }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
        expect(() => qc.test(vars)).toThrow('$ne: variable myInt is of type number while operand is of type string');
    });

    test('testStrictNeFullSyntaxIntNotEqualsString137: [STRICT] $ne full syntax // int[137] != string["137"] throws, like $eq', () => {
        const qc = qcOf({ myInt: { '$ne': '137' } }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
        expect(() => qc.test(vars)).toThrow('$ne: variable myInt is of type number while operand is of type string');
    });

    test('testStrictNeFullSyntaxIntNotEqualsInt138: [STRICT] $ne full syntax // int[137] != int[138] still works', () => {
        expect(qcOf({ myInt: { '$ne': 138 } }, true).test(vars)).toBe(true);
    });

    test.each([
        ['testStrictGtFullSyntaxIntGreaterThanString136', '$gt', '136'],
        ['testStrictGtFullSyntaxIntNotGreaterThanString138', '$gt', '138'],
        ['testStrictLtFullSyntaxIntLessThanString138', '$lt', '138'],
        ['testStrictLtFullSyntaxIntNotLessThanString136', '$lt', '136'],
    ])('%s: [STRICT] int[137] %s string[%s] throws', (_name, operator, operand) => {
        const qc = qcOf({ myInt: { [operator]: operand } }, true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
    });

    test.each([
        ['testStrictWithNullInputData', 'null input data', null],
        ['testStrictWithNonHashDataArray', 'non-hash data (array)', []],
        ['testStrictWithNonHashDataString', 'non-hash data (string)', 'not an object'],
        ['testStrictWithNonHashDataNumber', 'non-hash data (number)', 42],
        ['testStrictWithNonHashDataBoolean', 'non-hash data (boolean)', true],
    ])('%s: [STRICT] test with %s', (_name, _desc, data) => {
        const qc = qcOf({ myString: 'this is a string' }, true);
        expect(() => qc.test(data)).toThrow(StrictTypeError);
    });
});

// OPERAND EVALUATOR TESTS

describe('operand evaluator', () => {
    function withEvaluator(query) {
        const qc = new QueryCheck(query);
        qc.setOperandEvaluator(createOpEvaluator(qc));
        qc.setStrictMode(false);
        return qc;
    }

    test('testTimeFunctionReturnsGivenDate: $time function returns given date', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$time': { date: '2020-05-21T13:59:48' } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testTimeFunctionReturnsGivenDateUsingInputFormat: $time function returns given date using different input format', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$time': { date: '21.05.2020, 13:59:48', inputFormat: 'dd.MM.yyyy, HH:mm:ss' } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testTimeFunctionReturnsModifiedDate: $time function returns modified date (-2 days and -3 hours)', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$time': { date: '2020-05-23T16:59:48', sub: { days: 2, hours: 3 } } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testTimeFunctionCascading: $time function cascading (+10 days and -10 days)', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$time': { date: { '$time': { date: '2020-05-21T13:59:48', sub: { days: 10 } } }, add: { days: 10 } } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testTimeFunctionCascadingWithVar: $time function cascading (+10 days and -10 days) combined with $var function', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$time': { date: { '$time': { date: { '$var': { name: 'now.isoDateTime' } }, sub: { days: 10 } } }, add: { days: 10 } } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testConcatFunctionWithStrings: $concat function with string and $var (all of type string)', () => {
        const qc = withEvaluator({ 'now.isoDateTime': { '$concat': [{ '$var': { name: 'now.isoDate' } }, 'T', { '$var': { name: 'now.isoTime' } }] } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testConcatFunctionWithStringCasting: $concat function with string and $var (with string casting)', () => {
        const qc = withEvaluator({ myStringPrime: { '$concat': ['prime', ' ', 'number', ' ', { '$var': { name: 'myInt' } }] } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testLookupFunctionWithStaticMapKey: $lookup function with static map/key (key exists)', () => {
        const qc = withEvaluator({ 'myObject.userName': { '$lookup': { map: { this: 'is', a: 'lookup', user: 'maurice' }, key: 'user', default: null } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testLookupFunctionWithVariableMapKey: $lookup function with variable map/key (key exists)', () => {
        const qc = withEvaluator({ 'myObject.userName': { '$lookup': { map: { '$var': 'myLookup' }, key: { '$var': 'lookupKey' }, default: null } } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testLookupFunctionKeyDoesNotExist: $lookup function with variable map and static key (where key does not exist)', () => {
        const qc = withEvaluator({ 'myObject.userName': { '$lookup': { map: { '$var': 'myLookup' }, key: 'non-existant' } } });
        expect(qc.test(vars)).toBe(false);
    });

    test('testLookupFunctionKeyDoesNotExistButDefaultMatches: $lookup function with variable map and static key (where key does not exist but default matches)', () => {
        const qc = withEvaluator({ 'myObject.userName': { '$lookup': { map: { '$var': 'myLookup' }, key: 'non-existant', default: 'maurice' } } });
        expect(qc.test(vars)).toBe(true);
    });
});

// $EXPR TESTS

describe('$expr', () => {
    test('testExprWithGtAndAdd: $expr with $gt and $add // (field1 + field2) > 10', () => {
        const qc = qcOf({ '$expr': { '$gt': [{ '$add': ['$myInt', '$myFloat'] }, 200] } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testExprCompareTwoFields: $expr compare two fields // spent > budget', () => {
        const qc = qcOf({ '$expr': { '$gt': ['$spent', '$budget'] } });
        expect(qc.test({ spent: 450, budget: 400 })).toBe(true);
    });

    test('testExprWithSubtract: $expr with $subtract // (price - discount) < 100', () => {
        const qc = qcOf({ '$expr': { '$lt': [{ '$subtract': ['$price', '$discount'] }, 90] } });
        expect(qc.test({ price: 100, discount: 20 })).toBe(true);
    });

    test('testExprWithMultiply: $expr with $multiply // (field1 * field2) >= 35', () => {
        const qc = qcOf({ '$expr': { '$gte': [{ '$multiply': ['$field1', '$field2'] }, 35] } });
        expect(qc.test({ field1: 5, field2: 7 })).toBe(true);
    });

    test('testExprWithDivide: $expr with $divide // (field1 / field2) == 2', () => {
        const qc = qcOf({ '$expr': { '$eq': [{ '$divide': ['$field1', '$field2'] }, 2] } });
        expect(qc.test({ field1: 10, field2: 5 })).toBe(true);
    });

    test('testExprWithMod: $expr with $mod // (field1 % field2) == 2', () => {
        const qc = qcOf({ '$expr': { '$eq': [{ '$mod': ['$field1', '$field2'] }, 2] } });
        expect(qc.test({ field1: 17, field2: 5 })).toBe(true);
    });

    test('testExprWithCond: $expr with $cond // conditional discount calculation', () => {
        const qc = qcOf({
            '$expr': {
                '$lt': [
                    {
                        '$cond': {
                            if: { '$gte': ['$qty', 100] },
                            then: { '$multiply': ['$price', 0.5] },
                            else: { '$multiply': ['$price', 0.75] },
                        },
                    },
                    60,
                ],
            },
        });
        expect(qc.test({ qty: 150, price: 100 })).toBe(true);
    });

    test('testExprComplexNested: $expr with complex nested expression', () => {
        const qc = qcOf({
            '$expr': {
                '$eq': [
                    { '$add': [{ '$multiply': ['$field1', 2] }, { '$subtract': ['$field2', 3] }] },
                    14,
                ],
            },
        });
        expect(qc.test({ field1: 5, field2: 7 })).toBe(true);
    });

    test('testExprWithNe: $expr with $ne // field1 != field2', () => {
        const qc = qcOf({ '$expr': { '$ne': ['$field1', '$field2'] } });
        expect(qc.test({ field1: 5, field2: 7 })).toBe(true);
    });

    test('testExprWithLte: $expr with $lte // field1 <= field2', () => {
        const qc = qcOf({ '$expr': { '$lte': ['$field1', '$field2'] } });
        expect(qc.test({ field1: 5, field2: 5 })).toBe(true);
    });

    test('testExprReturnsFalse: $expr returns false when condition not met', () => {
        const qc = qcOf({ '$expr': { '$gt': [{ '$add': ['$field1', '$field2'] }, 20] } });
        expect(qc.test({ field1: 5, field2: 7 })).toBe(false);
    });

    test('testExprWithOperandEvaluator: $expr with operandEvaluator for custom $var resolution', () => {
        const qc = new QueryCheck({
            '$expr': { '$gt': [{ '$multiply': [{ '$var': 'price' }, { '$var': 'multiplier' }] }, 150] },
        });
        qc.setOperandEvaluator((params, data) => {
            if (isObject(params) && params['$var'] !== undefined && params['$var'] !== null) {
                return qc.getVariableValue(params['$var'], data);
            }
            return params;
        });
        qc.setStrictMode(false);
        expect(qc.test({ price: 100, multiplier: 2 })).toBe(true);
    });

    test('testExprFieldWithoutDollarSignTreatedAsLiteral: $expr with $add treats field names without $ as literal strings', () => {
        const qc = qcOf({ '$expr': { '$eq': [{ '$add': ['field1', 5] }, 'field15'] } });
        const data = { field1: 10, field2: 20 };
        expect(() => qc.test(data)).toThrow(QuerySyntaxError);
        expect(() => qc.test(data)).toThrow('$add operands must be numeric');
    });

    test('testExprFieldWithDollarSignWorks: $expr with $add using correct $field syntax works', () => {
        const qc = qcOf({ '$expr': { '$eq': [{ '$add': ['$field1', '$field2'] }, 30] } });
        expect(qc.test({ field1: 10, field2: 20 })).toBe(true);
    });

    test('testExprWithAnd: $expr combined with regular field queries using $and', () => {
        const qc = qcOf({
            '$and': [
                { category: 'electronics' },
                { inStock: true },
                { '$expr': { '$lt': [{ '$subtract': ['$price', '$discount'] }, 90] } },
            ],
        });
        expect(qc.test({ category: 'electronics', price: 100, discount: 20, inStock: true })).toBe(true);
    });

    test('testExprWithAndReturnsFalse: $expr combined with $and returns false when expression fails', () => {
        const qc = qcOf({
            '$and': [
                { category: 'electronics' },
                { inStock: true },
                { '$expr': { '$lt': [{ '$subtract': ['$price', '$discount'] }, 90] } },
            ],
        });
        expect(qc.test({ category: 'electronics', price: 100, discount: 10, inStock: true })).toBe(false);
    });
});

// AGGREGATION $NOT OPERATOR TESTS

describe('aggregation $not', () => {
    test.each([
        ['testExprAggNotTrue', '$not[true] returns false', true, false],
        ['testExprAggNotFalse', '$not[false] returns true', false, true],
        ['testExprAggNotNull', '$not[null] returns true', null, true],
        ['testExprAggNotZero', '$not[0] returns true', 0, true],
        ['testExprAggNotFloatZero', '$not[0.0] returns true (float zero is falsy in MongoDB)', 0.0, true],
        ['testExprAggNotOne', '$not[1] returns false', 1, false],
        ['testExprAggNotNonZeroNumber', '$not[137] returns false', 137, false],
        ['testExprAggNotArrayWithFalse', '$not[[false]] returns false (array is truthy)', [false], false],
    ])('%s: $expr with $not // %s', (_name, _desc, value, expected) => {
        const qc = qcOf({ '$expr': { '$not': [value] } });
        expect(qc.test(vars)).toBe(expected);
    });

    test('testExprAggNotWithGtExpression: $expr with $not // $not[$gt[$qty, 250]]', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$gt': ['$qty', 250] }] } });
        expect(qc.test({ qty: 200 })).toBe(true);
    });

    test('testExprAggNotWithGtExpressionFalse: $expr with $not // $not[$gt[$qty, 250]] returns false when qty > 250', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$gt': ['$qty', 250] }] } });
        expect(qc.test({ qty: 300 })).toBe(false);
    });

    test('testExprAggNotWithEqEqual: $expr with $not // $not[$eq[field1, field2]] when fields are equal', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$eq': ['$field1', '$field2'] }] } });
        expect(qc.test({ field1: 100, field2: 100 })).toBe(false);
    });

    test('testExprAggNotWithEqNotEqual: $expr with $not // $not[$eq[field1, field2]] when fields are not equal', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$eq': ['$field1', '$field2'] }] } });
        expect(qc.test({ field1: 100, field2: 200 })).toBe(true);
    });

    test('testExprAggNotWithEqLiteralEqual: $expr with $not // $not[$eq[field, literal]] when equal', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$eq': ['$status', 'active'] }] } });
        expect(qc.test({ status: 'active' })).toBe(false);
    });

    test('testExprAggNotWithEqLiteralNotEqual: $expr with $not // $not[$eq[field, literal]] when not equal', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$eq': ['$status', 'active'] }] } });
        expect(qc.test({ status: 'inactive' })).toBe(true);
    });
});

// AGGREGATION $IN OPERATOR TESTS

describe('aggregation $in', () => {
    test('testExprAggInValueInArray: $expr with $in // value in array returns true', () => {
        expect(qcOf({ '$expr': { '$in': ['banana', ['apple', 'banana', 'cherry']] } }).test(vars)).toBe(true);
    });

    test('testExprAggInValueNotInArray: $expr with $in // value not in array returns false', () => {
        expect(qcOf({ '$expr': { '$in': ['orange', ['apple', 'banana', 'cherry']] } }).test(vars)).toBe(false);
    });

    test('testExprAggInFieldValueInArray: $expr with $in // field value in array', () => {
        const qc = qcOf({ '$expr': { '$in': ['$fruit', '$in_stock'] } });
        expect(qc.test({ fruit: 'banana', in_stock: ['apple', 'banana', 'cherry'] })).toBe(true);
    });

    test('testExprAggInFieldValueNotInArray: $expr with $in // field value not in array', () => {
        const qc = qcOf({ '$expr': { '$in': ['$fruit', '$in_stock'] } });
        expect(qc.test({ fruit: 'orange', in_stock: ['apple', 'banana', 'cherry'] })).toBe(false);
    });

    test('testExprAggInNumberInArray: $expr with $in // number in array', () => {
        expect(qcOf({ '$expr': { '$in': ['$value', [100, 137, 200]] } }).test({ value: 137 })).toBe(true);
    });

    test('testExprAggInNullInArray: $expr with $in // null in array', () => {
        expect(qcOf({ '$expr': { '$in': [null, [1, 2, null, 3]] } }).test(vars)).toBe(true);
    });

    test('testExprAggInEmptyArray: $expr with $in // empty array returns false', () => {
        expect(qcOf({ '$expr': { '$in': ['banana', '$myEmptyArray'] } }).test(vars)).toBe(false);
    });

    test('testExprAggInObjectInArray: $expr with $in // object in array of objects', () => {
        const qc = qcOf({ '$expr': { '$in': ['$item', '$items'] } });
        expect(qc.test({ item: { x: 10, y: 11 }, items: [{ x: 10, y: 11 }, { x: 20, y: 21 }] })).toBe(true);
    });
});

// COMBINED TESTS

describe('combined $not / $in', () => {
    test('testExprAggNotWithIn: $expr with $not and $in // $not[$in[value, array]]', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': ['$fruit', '$in_stock'] }] } });
        expect(qc.test({ fruit: 'orange', in_stock: ['apple', 'banana', 'cherry'] })).toBe(true);
    });

    test('testExprAggNotWithInFalse: $expr with $not and $in // $not[$in[value, array]] returns false when value is in array', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': ['$fruit', '$in_stock'] }] } });
        expect(qc.test({ fruit: 'banana', in_stock: ['apple', 'banana', 'cherry'] })).toBe(false);
    });

    test('testExprAggNotWithInLiterals: $expr with $not and $in // $not[$in[literal, literal array]]', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': ['grape', ['apple', 'banana', 'cherry']] }] } });
        expect(qc.test(vars)).toBe(true);
    });

    test('testExprAggNotWithInNumbers: $expr with $not and $in // $not[$in[number, number array]]', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': ['$value', [10, 20, 30, 40]] }] } });
        expect(qc.test({ value: 42 })).toBe(true);
    });

    test('testExprAggNotWithInComputedValue: $expr with $not and $in // $not[$in[computed value, array]]', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': [{ '$subtract': ['$price', '$discount'] }, '$invalid_prices'] }] } });
        expect(qc.test({ price: 100, discount: 30, invalid_prices: [50, 60, 80] })).toBe(true);
    });

    test('testExprAggNotWithInComputedValueFalse: $expr with $not and $in // $not[$in[computed value, array]] returns false when value is in array', () => {
        const qc = qcOf({ '$expr': { '$not': [{ '$in': [{ '$subtract': ['$price', '$discount'] }, '$invalid_prices'] }] } });
        expect(qc.test({ price: 100, discount: 20, invalid_prices: [50, 60, 80] })).toBe(false);
    });

    test('testExprAggInWithComparison: $expr with $in and comparison // check if discounted price is in valid range', () => {
        const qc = qcOf({ '$expr': { '$in': [{ '$subtract': ['$price', '$discount'] }, '$valid_prices'] } });
        expect(qc.test({ price: 100, discount: 20, valid_prices: [50, 80, 100, 150] })).toBe(true);
    });
});

// $SIZE AGGREGATION OPERATOR TESTS

describe('aggregation $size', () => {
    test('testExprAggSize: $expr with $size // returns array length', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$size': '$colors' }, 3] } });
        expect(qc.test({ colors: ['blue', 'black', 'red'] })).toBe(true);
    });

    test('testExprAggSizeEmpty: $expr with $size // empty array returns 0', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$size': '$colors' }, 0] } });
        expect(qc.test({ colors: [] })).toBe(true);
    });

    test('testExprAggSizeWithGt: $expr with $size // use with $gt for minimum elements', () => {
        const qc = new QueryCheck({ '$expr': { '$gt': [{ '$size': '$tags' }, 3] } });
        expect(qc.test({ tags: ['php', 'mongodb', 'querycheck', 'testing'] })).toBe(true);
    });

    test('testExprAggSizeWithLt: $expr with $size // use with $lt for maximum elements', () => {
        const qc = new QueryCheck({ '$expr': { '$lt': [{ '$size': '$items' }, 5] } });
        expect(qc.test({ items: ['a', 'b'] })).toBe(true);
    });

    test('testExprAggSizeWithGte: $expr with $size // use with $gte', () => {
        const qc = new QueryCheck({ '$expr': { '$gte': [{ '$size': '$items' }, 3] } });
        expect(qc.test({ items: ['x', 'y', 'z'] })).toBe(true);
    });

    test('testExprAggSizeThrowsOnNonArray: $expr with $size // throws on non-array', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$size': '$name' }, 4] } });
        expect(() => qc.test({ name: 'John' })).toThrow(QuerySyntaxError);
        expect(() => qc.test({ name: 'John' })).toThrow('$size: argument must resolve to an array');
    });

    test('testExprAggSizeThrowsOnObject: $expr with $size // throws on associative array (object)', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$size': '$data' }, 2] } });
        expect(() => qc.test({ data: { x: 1, y: 2 } })).toThrow(QuerySyntaxError);
        expect(() => qc.test({ data: { x: 1, y: 2 } })).toThrow('$size: argument must resolve to an array');
    });

    test('testExprAggSizeWithCond: $expr with $size // combined with $cond', () => {
        const qc = new QueryCheck({
            '$expr': {
                '$eq': [
                    { '$cond': { if: { '$gte': [{ '$size': '$items' }, 5] }, then: 'bulk', else: 'single' } },
                    'bulk',
                ],
            },
        });
        expect(qc.test({ items: ['a', 'b', 'c', 'd', 'e'] })).toBe(true);
    });

    test('testExprAggSizeWithLiteralArray: $expr with $size // with literal array', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$size': [1, 2, 3, 4] }, 4] } });
        expect(qc.test({ dummy: 'value' })).toBe(true);
    });
});

// ARRAY INDEX ACCESS TESTS

describe('array index access', () => {
    test('testExprArrayIndexAccess: $expr with array index access // $myArray[0] and $myList[0].amount', () => {
        const data = {
            myArray: [10, 20, 30],
            myList: [
                { amount: 100, name: 'first' },
                { amount: 200, name: 'second' },
            ],
        };

        expect(new QueryCheck({ '$expr': { '$eq': ['$myArray[0]', 10] } }).test(data)).toBe(true);
        expect(new QueryCheck({ '$expr': { '$eq': ['$myList[0].amount', 100] } }).test(data)).toBe(true);
        expect(new QueryCheck({ '$expr': { '$lt': ['$myList[0].amount', '$myList[1].amount'] } }).test(data)).toBe(true);
        expect(new QueryCheck({ '$expr': { '$eq': [{ '$add': ['$myArray[0]', '$myArray[1]'] }, 30] } }).test(data)).toBe(true);
    });

    test('testExprDeeplyNestedArrayIndexAccess: $expr with deeply nested array index access // $myObj.sub1.sub2.myList[0].amount', () => {
        const data = {
            myObj: {
                sub1: {
                    sub2: {
                        myList: [
                            { amount: 42, name: 'first' },
                            { amount: 99, name: 'second' },
                        ],
                    },
                },
            },
        };

        expect(new QueryCheck({ '$expr': { '$eq': ['$myObj.sub1.sub2.myList[0].amount', 42] } }).test(data)).toBe(true);
        expect(new QueryCheck({ '$expr': { '$eq': ['$myObj.sub1.sub2.myList[1].name', 'second'] } }).test(data)).toBe(true);
    });

    test('testExprAndWithSizeAndArrayAccess: $expr with $and // check $size >= 1 before accessing myList[0]', () => {
        const qc = new QueryCheck({
            '$and': [
                { '$expr': { '$gte': [{ '$size': '$myList' }, 1] } },
                { '$expr': { '$eq': ['$myList[0].amount', 100] } },
            ],
        });
        expect(qc.test({ myList: [{ amount: 100, name: 'first' }] })).toBe(true);
        expect(qc.test({ myList: [] })).toBe(false);
    });

    test('testOrShortCircuitsWithSizeAndArrayAccess: $or short-circuit // empty list matches first branch, myList[0] is never accessed', () => {
        const qc = new QueryCheck({
            '$or': [
                { '$expr': { '$eq': [{ '$size': '$myList' }, 0] } },
                { 'myList[0].amount': 100 },
            ],
        });

        expect(qc.test({ myList: [] })).toBe(true);
        expect(qc.test({ myList: [{ amount: 100 }] })).toBe(true);
        expect(qc.test({ myList: [{ amount: 5 }] })).toBe(false);
    });

    test('testOrEvaluatesUntilFirstMatch: $or short-circuit // later branches still run until one matches', () => {
        const qc = new QueryCheck({ '$or': [{ a: 1 }, { missing: 1 }] });
        expect(qc.test({ a: 1 })).toBe(true);
        expect(() => qc.test({ a: 2 })).toThrow(UnknownVariableException);
    });

    test('testOrShortCircuitSkipsOperandEvaluator: $or short-circuit // operand evaluator is not called for skipped branches', () => {
        const seen = [];
        const qc = new QueryCheck({ '$or': [{ a: { '$var': 'x' } }, { b: { '$var': 'y' } }] });
        qc.setOperandEvaluator((operand, data) => {
            if (isObject(operand) && typeof operand['$var'] === 'string') {
                seen.push(operand['$var']);
                return qc.getVariableValue(operand['$var'], data);
            }
            return operand;
        });

        expect(qc.test({ a: 1, b: 2, x: 1, y: 2 })).toBe(true);
        expect(seen).toEqual(['x']);
    });
});

// $toLower / $toUpper AGGREGATION OPERATOR TESTS

describe('aggregation $toLower / $toUpper', () => {
    test('testExprAggToLower: $expr with $toLower // converts string to lowercase', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$toLower': '$name' }, 'john doe'] } });
        expect(qc.test({ name: 'JOHN DOE' })).toBe(true);
    });

    test('testExprAggToUpper: $expr with $toUpper // converts string to uppercase', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$toUpper': '$name' }, 'JOHN DOE'] } });
        expect(qc.test({ name: 'john doe' })).toBe(true);
    });

    test('testExprAggToLowerCaseInsensitiveComparison: $expr with $toLower // case-insensitive comparison of two fields', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$toLower': '$field1' }, { '$toLower': '$field2' }] } });
        expect(qc.test({ field1: 'Hello World', field2: 'HELLO WORLD' })).toBe(true);
    });

    test('testExprAggToLowerUnicode: $expr with $toLower // handles unicode characters', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$toLower': '$name' }, 'müller'] } });
        expect(qc.test({ name: 'MÜLLER' })).toBe(true);
    });

    test('testExprAggToUpperThrowsOnNonString: $expr with $toUpper // throws on non-string', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$toUpper': '$value' }, '123'] } });
        expect(() => qc.test({ value: 123 })).toThrow(QuerySyntaxError);
        expect(() => qc.test({ value: 123 })).toThrow('$toUpper: argument must resolve to a string');
    });
});

// $substr / $substrBytes AGGREGATION OPERATOR TESTS

describe('aggregation $substr / $substrBytes', () => {
    test('testExprAggSubstr: $expr with $substr // extracts substring by codepoint', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$substr': ['$text', 0, 5] }, 'Hello'] } });
        expect(qc.test({ text: 'Hello World' })).toBe(true);
    });

    test('testExprAggSubstrUnicode: $expr with $substr // handles unicode codepoints', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$substr': ['$text', 0, 3] }, 'Mül'] } });
        expect(qc.test({ text: 'Müller' })).toBe(true);
    });

    test('testExprAggSubstrNegativeLength: $expr with $substr // negative length returns rest of string', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$substr': ['$text', 6, -1] }, 'World'] } });
        expect(qc.test({ text: 'Hello World' })).toBe(true);
    });

    test('testExprAggSubstrBytes: $expr with $substrBytes // extracts substring by bytes', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$substrBytes': ['$text', 0, 5] }, 'Hello'] } });
        expect(qc.test({ text: 'Hello World' })).toBe(true);
    });

    test('testExprAggSubstrBytesMultibyte: $expr with $substrBytes // byte-based on multibyte string', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$substrBytes': ['$text', 0, 1] }, 'M'] } });
        expect(qc.test({ text: 'Müller' })).toBe(true);
    });
});

// $strLenBytes / $strLenCP AGGREGATION OPERATOR TESTS

describe('aggregation $strLenBytes / $strLenCP', () => {
    test('testExprAggStrLenBytes: $expr with $strLenBytes // returns byte length', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$strLenBytes': '$text' }, 5] } });
        expect(qc.test({ text: 'Hello' })).toBe(true);
    });

    test('testExprAggStrLenBytesMultibyte: $expr with $strLenBytes // counts bytes for multibyte chars', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$strLenBytes': '$text' }, 7] } });
        expect(qc.test({ text: 'Müller' })).toBe(true);
    });

    test('testExprAggStrLenCP: $expr with $strLenCP // returns codepoint length', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$strLenCP': '$text' }, 5] } });
        expect(qc.test({ text: 'Hello' })).toBe(true);
    });

    test('testExprAggStrLenCPMultibyte: $expr with $strLenCP // counts codepoints for multibyte chars', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$strLenCP': '$text' }, 6] } });
        expect(qc.test({ text: 'Müller' })).toBe(true);
    });
});

// $trim / $ltrim / $rtrim AGGREGATION OPERATOR TESTS

describe('aggregation $trim / $ltrim / $rtrim', () => {
    test('testExprAggTrim: $expr with $trim // removes whitespace from both ends', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$trim': { input: '$text' } }, 'hello'] } });
        expect(qc.test({ text: '  hello  ' })).toBe(true);
    });

    test('testExprAggTrimWithChars: $expr with $trim // removes specified chars', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$trim': { input: '$text', chars: '-' } }, 'hello'] } });
        expect(qc.test({ text: '---hello---' })).toBe(true);
    });

    test('testExprAggLtrim: $expr with $ltrim // removes whitespace from left', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$ltrim': { input: '$text' } }, 'hello  '] } });
        expect(qc.test({ text: '  hello  ' })).toBe(true);
    });

    test('testExprAggRtrim: $expr with $rtrim // removes whitespace from right', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$rtrim': { input: '$text' } }, '  hello'] } });
        expect(qc.test({ text: '  hello  ' })).toBe(true);
    });
});

// $concat AGGREGATION OPERATOR TESTS

describe('aggregation $concat', () => {
    test('testExprAggConcat: $expr with $concat // concatenates strings', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$concat': ['$first', ' ', '$second'] }, 'Hello World'] } });
        expect(qc.test({ first: 'Hello', second: 'World' })).toBe(true);
    });

    test('testExprAggConcatMultiple: $expr with $concat // concatenates multiple strings', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$concat': ['$a', '$b', '$c'] }, 'abc'] } });
        expect(qc.test({ a: 'a', b: 'b', c: 'c' })).toBe(true);
    });

    test('testExprAggConcatThrowsOnNonString: $expr with $concat // throws on non-string', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$concat': ['$text', '$num'] }, 'hello123'] } });
        expect(() => qc.test({ text: 'hello', num: 123 })).toThrow(QuerySyntaxError);
        expect(() => qc.test({ text: 'hello', num: 123 })).toThrow('$concat: all arguments must resolve to strings');
    });
});

// $literal AGGREGATION OPERATOR TESTS

describe('aggregation $literal', () => {
    test('testExprAggLiteralDollarString: $expr with $literal // a string with $ is compared as a string, not a field reference', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': ['$price', { '$literal': '$1' }] } });
        expect(qc.test({ price: '$1' })).toBe(true);
        expect(qc.test({ price: '$2.50' })).toBe(false);
        expect(qc.test({ price: '1' })).toBe(false);
    });

    test('testExprWithoutLiteralIsFieldReference: $expr with $literal // without $literal, "$1" is a field reference', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': ['$price', '$1'] } });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test({ price: '$1' })).toBe(false);
        expect(qc.test({ price: 5, '1': 5 })).toBe(true);
    });

    test.each([
        ['operator object', { '$add': [2, 3] }],
        ['nested $literal', { '$literal': 1 }],
        ['list with field references', [1, '$x', { '$size': '$y' }]],
        ['null', null],
        ['number', 1],
        ['empty array', []],
    ])('testExprAggLiteralReturnsValueUnparsed: $expr with $literal // returns the value unparsed (%s)', (_name, value) => {
        const qc = new QueryCheck({ '$expr': { '$eq': ['$v', { '$literal': value }] } });
        qc.validate();
        expect(qc.test({ v: value })).toBe(true);
    });

    test('testExprAggLiteralDoesNotEvaluate: $expr with $literal // $literal: {$add: [2, 3]} is the object, not 5', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': [{ '$literal': { '$add': [2, 3] } }, 5] } });
        expect(qc.test({ v: 1 })).toBe(false);
    });

    test('testExprAggLiteralIsOpaque: $expr with $literal // contents are not checked, and not passed to the operand evaluator', () => {
        const qc = new QueryCheck({ '$expr': { '$eq': ['$v', { '$literal': { '$nope': 1 } }] } });
        qc.validate();
        expect(qc.test({ v: { '$nope': 1 } })).toBe(true);

        const seen = [];
        const withEvaluator = new QueryCheck({ '$expr': { '$eq': ['$v', { '$literal': { '$var': 'x' } }] } });
        withEvaluator.setOperandEvaluator((operand) => {
            seen.push(operand);
            return isObject(operand) && Object.keys(operand)[0] === '$var' ? 'resolved' : operand;
        });
        expect(withEvaluator.test({ v: { '$var': 'x' } })).toBe(true);
        expect(seen).not.toContainEqual({ '$var': 'x' });
    });

    test('testExprAggLiteralInOtherOperators: $expr with $literal // in $cond and $in', () => {
        let qc = new QueryCheck({ '$expr': { '$in': [{ '$literal': '$admin' }, '$roles'] } });
        expect(qc.test({ roles: ['user', '$admin'] })).toBe(true);
        expect(qc.test({ roles: ['user', 'admin'] })).toBe(false);

        qc = new QueryCheck({
            '$expr': {
                '$eq': [
                    { '$cond': { if: { '$gt': ['$n', 0] }, then: { '$literal': '$positive' }, else: '$label' } },
                    '$positive',
                ],
            },
        });
        expect(qc.test({ n: 1, label: 'x', positive: '$positive' })).toBe(true);
    });
});

// RELATIONAL OPERATOR TYPE TESTS ($gt / $gte / $lt / $lte)

describe('relational operator types', () => {
    const unorderableProvider = [
        ['string "admin" $gte 18', 'admin', '$gte', 18],
        ['string "admin" $gt 999999', 'admin', '$gt', 999999],
        ['empty array $gte 18', [], '$gte', 18],
        ['list $gt 999', ['x'], '$gt', 999],
        ['object $gte 18', { years: 5 }, '$gte', 18],
        ['null $lt 5', null, '$lt', 5],
        ['null $lte 0', null, '$lte', 0],
        ['null $gte 0', null, '$gte', 0],
        ['false $lt 1', false, '$lt', 1],
        ['false $gte 0', false, '$gte', 0],
        ['true $gte 1', true, '$gte', 1],
        ['true $gt 0', true, '$gt', 0],
        ['number $gt string "admin"', 137, '$gt', 'admin'],
        ['number $lt operand null', 1, '$lt', null],
        ['number $lt operand true', 0, '$lt', true],
    ];

    test('testRelationalArrayOperand: relational operators // an array literal operand is a SyntaxError, inside $expr it does not match', () => {
        const expr = new QueryCheck({ '$expr': { '$lt': ['$field', [1]] } });
        expect(expr.test({ field: 0 })).toBe(false);

        const qc = new QueryCheck({ field: { '$lt': [1] } });
        expect(() => qc.test({ field: 0 })).toThrow(QuerySyntaxError);
        expect(() => qc.test({ field: 0 })).toThrow('field.$lt: $lt cannot compare with an array or object');
    });

    test.each(unorderableProvider)('testRelationalUnorderableDoesNotMatch: unorderable value does not match (%s)', (_name, value, operator, operand) => {
        const qc = new QueryCheck({ field: { [operator]: operand } });
        expect(qc.test({ field: value })).toBe(false);
    });

    test.each(unorderableProvider)('testExprRelationalUnorderableDoesNotMatch: $expr: unorderable value does not match (%s)', (_name, value, operator, operand) => {
        const qc = new QueryCheck({ '$expr': { [operator]: ['$field', operand] } });
        expect(qc.test({ field: value })).toBe(false);
    });

    test.each([
        ['int $gte int', 30, '$gte', 18, true],
        ['int $gte int (false)', 17, '$gte', 18, false],
        ['float $gt int', 18.5, '$gt', 18, true],
        ['int $gte float', 1, '$gte', 1.0, true],
        ['numeric string $gt int', '137', '$gt', 136, true],
        ['int $gt numeric string', 137, '$gt', '136', true],
        ['int $gt numeric string (false)', 137, '$gt', '138', false],
        ['string $gt string', '13:59', '$gt', '10:00', true],
        ['string $lt string', '13:59', '$lt', '12:00', false],
    ])('testRelationalOrderable: orderable values still compare (%s)', (_name, value, operator, operand, expected) => {
        const qc = new QueryCheck({ field: { [operator]: operand } });
        expect(qc.test({ field: value })).toBe(expected);

        const expr = new QueryCheck({ '$expr': { [operator]: ['$field', operand] } });
        expect(expr.test({ field: value })).toBe(expected);
    });

    test('testRelationalNullIntermediateDoesNotMatch: relational operators // null intermediate does not pass a numeric bound', () => {
        const qc = new QueryCheck({ 'profile.age': { '$gte': 0, '$lt': 120 } });
        expect(qc.test({ profile: null })).toBe(false);
    });

    test('testStrictRelationalNullDoesNotMatch: [STRICT] relational operators // null value does not match and does not throw', () => {
        const qc = qcOf({ failedAttempts: { '$lt': 5 } }, true);
        expect(qc.test({ failedAttempts: null })).toBe(false);
    });

    test('testStrictRelationalArrayThrows: [STRICT] relational operators // same unorderable type throws', () => {
        const qc = qcOf({ '$expr': { '$gte': ['$list', ['$other']] } }, true);
        const data = { list: [1], other: 1 };
        expect(() => qc.test(data)).toThrow(StrictTypeError);
        expect(() => qc.test(data)).toThrow('$gte: first operand is of type array, which cannot be ordered');
    });

    test.each([
        ['true $gte true', { v: { '$gte': true } }, true, true],
        ['false $lt true', { v: { '$lt': true } }, false, true],
        ['true $gt false', { v: { '$gt': false } }, true, true],
        ['true $gt true', { v: { '$gt': true } }, true, false],
        ['null $gte null', { v: { '$gte': null } }, null, true],
        ['null $lte null', { v: { '$lte': null } }, null, true],
        ['null $gt null', { v: { '$gt': null } }, null, false],
        ['null $lt null', { v: { '$lt': null } }, null, false],
        ['$expr true $gte true', { '$expr': { '$gte': ['$v', true] } }, true, true],
        ['$expr null $lte null', { '$expr': { '$lte': ['$v', null] } }, null, true],
    ])('testBoolNullOrdering: booleans and null order against their own type (%s)', (_name, query, value, expected) => {
        expect(qcOf(query).test({ v: value })).toBe(expected);
        expect(qcOf(query, true).test({ v: value })).toBe(expected);
    });
});

// NUMBERS BEYOND 2^53 (BigInt for the PHP integer side)

describe('numbers beyond 2^53', () => {
    const big = 9007199254740993n; // 2^53 + 1
    const bigFloat = 9007199254740992; // 2^53.0
    const PHP_INT_MAX = 9223372036854775807n;

    test.each([
        ['2^53+1 $eq 2^53.0', { v: bigFloat }, big, false],
        ['2^53+1 $ne 2^53.0', { v: { '$ne': bigFloat } }, big, true],
        ['2^53+1 $gt 2^53.0', { v: { '$gt': bigFloat } }, big, true],
        ['2^53+1 $lte 2^53.0', { v: { '$lte': bigFloat } }, big, false],
        ['2^53.0 $lt 2^53+1', { v: { '$lt': big } }, bigFloat, true],
        ['2^53 $eq 2^53.0', { v: bigFloat }, 9007199254740992n, true],
        ['2^53+1 $in [2^53.0]', { v: { '$in': [bigFloat] } }, big, false],
        ['PHP_INT_MAX $lt INF', { v: { '$lt': Infinity } }, PHP_INT_MAX, true],
        ['PHP_INT_MAX $lt 2^63.0', { v: { '$lt': 9.2233720368547758E18 } }, PHP_INT_MAX, true],
        ['$expr 2^53+1 $gt 2^53.0', { '$expr': { '$gt': ['$v', bigFloat] } }, big, true],
        ['$expr 2^53+1 $eq 2^53.0', { '$expr': { '$eq': ['$v', bigFloat] } }, big, false],
    ])('testBigNumbersComparedExactly: integer vs float compared exactly (%s)', (_name, query, value, expected) => {
        expect(qcOf(query).test({ v: value })).toBe(expected);
        expect(qcOf(query, true).test({ v: value })).toBe(expected);
    });
});

// ARRAY FIELD TESTS ($eq / $ne / $in, like MongoDB)

describe('array fields', () => {
    test.each([
        ['$ne "banned" on ["banned"]', { role: { '$ne': 'banned' } }, ['banned'], false],
        ['$ne "banned" on ["banned", "admin"]', { role: { '$ne': 'banned' } }, ['banned', 'admin'], false],
        ['$ne "banned" on ["admin"]', { role: { '$ne': 'banned' } }, ['admin'], true],
        ['$ne "banned" on []', { role: { '$ne': 'banned' } }, [], true],
        ['$ne ["a", "b"] on ["a", "b"]', { role: { '$ne': ['a', 'b'] } }, ['a', 'b'], false],
        ['$ne 1 on [1.0]', { role: { '$ne': 1 } }, [1.0], false],
        ['$in ["admin"] on ["admin"]', { role: { '$in': ['admin'] } }, ['admin'], true],
        ['$in ["admin"] on ["user", "admin"]', { role: { '$in': ['admin'] } }, ['user', 'admin'], true],
        ['$in ["admin"] on ["user"]', { role: { '$in': ['admin'] } }, ['user'], false],
        ['$in ["admin"] on []', { role: { '$in': ['admin'] } }, [], false],
        ['$in [["a", "b"]] on ["a", "b"]', { role: { '$in': [['a', 'b']] } }, ['a', 'b'], true],
        ['$not $in ["banned"] on ["banned", "admin"]', { role: { '$not': { '$in': ['banned'] } } }, ['banned', 'admin'], false],
        ['$not $in ["banned"] on ["admin"]', { role: { '$not': { '$in': ['banned'] } } }, ['admin'], true],
        ['$eq [1] on [1, 5] (not contained as element)', { role: [1] }, [1, 5], false],
        ['$eq "admin" on ["user", "admin"]', { role: 'admin' }, ['user', 'admin'], true],
    ])('testArrayField: $eq, $ne and $in match elements, $ne is the negation of $eq (%s)', (_name, query, value, expected) => {
        expect(qcOf(query).test({ role: value })).toBe(expected);
        expect(qcOf(query, true).test({ role: value })).toBe(expected);
    });

    test('testArrayFieldEqNeExclusive: array field // $eq and $ne never both match', () => {
        const values = [['banned'], ['banned', 'admin'], ['admin'], [], [1, 2], [[1, 2]], ['1'], [1.0], [null], ['a', null]];
        const operands = ['banned', 'admin', 1, '1', [1, 2], [], null];
        const failures = [];
        for (const value of values) {
            for (const operand of operands) {
                const eq = new QueryCheck({ v: { '$eq': operand } }).test({ v: value });
                const ne = new QueryCheck({ v: { '$ne': operand } }).test({ v: value });
                if (eq === ne) {
                    failures.push(`${JSON.stringify(value)} vs ${JSON.stringify(operand)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    test('testStrictExprRelationalThrows: [STRICT] $expr relational operators // type mismatch throws', () => {
        const qc = qcOf({ '$expr': { '$gte': ['$age', 18] } }, true);
        expect(() => qc.test({ age: 'admin' })).toThrow(StrictTypeError);
        expect(() => qc.test({ age: 'admin' })).toThrow('$gte: first operand is of type string while second operand is of type number');
    });

    test('testStrictExprRelationalSameType: [STRICT] $expr relational operators // same type compares', () => {
        const qc = qcOf({ '$expr': { '$gte': ['$age', 18] } }, true);
        expect(qc.test({ age: 30 })).toBe(true);
        expect(qc.test({ age: 17 })).toBe(false);
    });
});

// INTEGER VS FLOAT TESTS (one numeric type; trivially true in JS)

describe('integer vs float', () => {
    const intFloatProvider = [
        ['$gt float vs int', { v: { '$gt': 10 } }, { v: 12.1 }, true],
        ['$lt int vs float', { v: { '$lt': 12.5 } }, { v: 12 }, true],
        ['$gte int vs float (equal)', { v: { '$gte': 12.0 } }, { v: 12 }, true],
        ['$eq int vs float', { v: 12 }, { v: 12.0 }, true],
        ['$eq float vs int (not equal)', { v: 12 }, { v: 12.1 }, false],
        ['$ne int vs float', { v: { '$ne': 1 } }, { v: 1.0 }, false],
        ['$ne int vs float (not equal)', { v: { '$ne': 1 } }, { v: 1.5 }, true],
        ['$in int vs float', { v: { '$in': [12, 13] } }, { v: 12.0 }, true],
        ['$eq list contains float', { v: 12 }, { v: [11.0, 12.0] }, true],
        ['$expr $gt float vs int', { '$expr': { '$gt': ['$v', 10] } }, { v: 12.1 }, true],
        ['$expr $gt $divide result', { '$expr': { '$gt': [{ '$divide': ['$v', 5] }, 2] } }, { v: 12 }, true],
        ['$expr $eq int vs float', { '$expr': { '$eq': ['$v', 12] } }, { v: 12.0 }, true],
        ['$expr $ne int vs float', { '$expr': { '$ne': ['$v', 12] } }, { v: 12.0 }, false],
        ['$expr $in int vs float', { '$expr': { '$in': ['$v', [12]] } }, { v: 12.0 }, true],
    ];

    test.each(intFloatProvider)('testIntFloatComparedAsNumbers: compared as numbers (%s)', (_name, query, data, expected) => {
        expect(qcOf(query).test(data)).toBe(expected);
    });

    test.each(intFloatProvider)('testStrictIntFloatComparedAsNumbers: [STRICT] compared as numbers, no StrictTypeError (%s)', (_name, query, data, expected) => {
        expect(qcOf(query, true).test(data)).toBe(expected);
    });
});

// STRING VS STRING TESTS (compared as text, like MongoDB)

describe('string ordering', () => {
    test.each([
        ['"12.0" $gt "12"', { v: { '$gt': '12' } }, { v: '12.0' }, true],
        ['"12.0" $lte "12"', { v: { '$lte': '12' } }, { v: '12.0' }, false],
        ['"10" $gt "9" (text: "1" < "9")', { v: { '$gt': '9' } }, { v: '10' }, false],
        ['"10" $lt "9"', { v: { '$lt': '9' } }, { v: '10' }, true],
        ['"1e3" in range "1000".."1000"', { v: { '$gte': '1000', '$lte': '1000' } }, { v: '1e3' }, false],
        ['"1000" in range "1000".."1000"', { v: { '$gte': '1000', '$lte': '1000' } }, { v: '1000' }, true],
        ['"abc" $lt "abd"', { v: { '$lt': 'abd' } }, { v: 'abc' }, true],
        ['zero-padded time', { v: { '$gte': '09:00', '$lt': '18:00' } }, { v: '13:59' }, true],
        ['$expr "10" $gt "9"', { '$expr': { '$gt': ['$v', '9'] } }, { v: '10' }, false],
        ['$expr "12.0" $gt "12"', { '$expr': { '$gt': ['$v', '12'] } }, { v: '12.0' }, true],
    ])('testStringOrderingAsText: compared as text (%s)', (_name, query, data, expected) => {
        expect(qcOf(query).test(data)).toBe(expected);
        expect(qcOf(query, true).test(data)).toBe(expected);
    });

    test('testNumericStringVsNumberStillNumeric: numeric string vs number // still compared as numbers in non-strict mode', () => {
        expect(new QueryCheck({ v: { '$gt': 9 } }).test({ v: '10' })).toBe(true);
        expect(new QueryCheck({ v: { '$gt': '9' } }).test({ v: 10 })).toBe(true);
    });
});

// NAN TESTS (NaN equals NaN, like MongoDB)

describe('NaN', () => {
    test.each([
        ['$eq NaN', { v: NaN }, true],
        ['$ne NaN', { v: { '$ne': NaN } }, false],
        ['$in [NaN]', { v: { '$in': [NaN] } }, true],
        ['$gte NaN', { v: { '$gte': NaN } }, true],
        ['$lte NaN', { v: { '$lte': NaN } }, true],
        ['$gt NaN', { v: { '$gt': NaN } }, false],
        ['$lt NaN', { v: { '$lt': NaN } }, false],
        ['$gt 0', { v: { '$gt': 0 } }, false],
        ['$lt 0', { v: { '$lt': 0 } }, false],
        ['$eq 0', { v: 0 }, false],
        ['$expr $eq NaN', { '$expr': { '$eq': ['$v', NaN] } }, true],
        ['$expr $ne NaN', { '$expr': { '$ne': ['$v', NaN] } }, false],
        ['$expr $gte NaN', { '$expr': { '$gte': ['$v', NaN] } }, true],
    ])('testNaN: equals NaN, matches no ordering against numbers (%s)', (_name, query, expected) => {
        expect(qcOf(query).test({ v: NaN })).toBe(expected);
        expect(qcOf(query, true).test({ v: NaN })).toBe(expected);
    });

    test('testNaNVsStringDoesNotWarn: NaN // $eq with a string does not match and does not warn', () => {
        expect(new QueryCheck({ v: NaN }).test({ v: 'NAN' })).toBe(false);
        expect(new QueryCheck({ v: 'NAN' }).test({ v: NaN })).toBe(false);
    });
});

// STRICT MODE: NO MIXING STRINGS AND NUMBERS

describe('string vs number equality', () => {
    test.each([
        ['$in [137] on "137"', { v: { '$in': [137] } }, { v: '137' }],
        ['$in ["137"] on 137', { v: { '$in': ['137'] } }, { v: 137 }],
        ['$eq 1 on list ["1"]', { v: 1 }, { v: ['1'] }],
        ['$expr $eq ["$v", 137] on "137"', { '$expr': { '$eq': ['$v', 137] } }, { v: '137' }],
        ['$expr $in ["$v", [137]] on "137"', { '$expr': { '$in': ['$v', [137]] } }, { v: '137' }],
    ])('testStringNumberEqualityNonStrictOnly: matches in non-strict mode only (%s)', (_name, query, data) => {
        expect(qcOf(query).test(data)).toBe(true);
        expect(qcOf(query, true).test(data)).toBe(false);
    });

    test('testStrictInMixedList: [STRICT] $in // mixed-type list still works', () => {
        const qc = qcOf({ v: { '$in': ['a', 1, 2.0] } }, true);
        expect(qc.test({ v: 2 })).toBe(true);
        expect(qc.test({ v: 'a' })).toBe(true);
        expect(qc.test({ v: '1' })).toBe(false);
    });

    test('testStrictEqStringVsNumberThrows: [STRICT] $eq // string vs number still throws', () => {
        const qc = qcOf({ v: 12 }, true);
        expect(() => qc.test({ v: '12' })).toThrow(StrictTypeError);
        expect(() => qc.test({ v: '12' })).toThrow('$eq: variable v is of type string while operand is of type number');
    });
});

// COMPILED QUERY TESTS

describe('compiled query', () => {
    test('testCompiledQueryIsReused: compiled query // reused across calls with different documents', () => {
        const qc = new QueryCheck({ age: { '$gte': 18 }, country: { '$in': ['DE', 'AT'] } });
        expect(qc.test({ age: 30, country: 'DE' })).toBe(true);
        expect(qc.test({ age: 12, country: 'DE' })).toBe(false);
        expect(qc.test({ age: 30, country: 'FR' })).toBe(false);
        expect(qc.test({ age: 18, country: 'AT' })).toBe(true);
    });

    test('testSettingChangeAfterTestRecompiles: compiled query // changing a setting after test() takes effect', () => {
        const qc = new QueryCheck({ myInt: { '$gt': '136' } });
        expect(qc.test(vars)).toBe(true);

        qc.setStrictMode(true);
        expect(() => qc.test(vars)).toThrow(StrictTypeError);
    });

    test('testThrowOnUnknownVariableAfterTestRecompiles: compiled query // setThrowOnUnknownVariable after test() takes effect', () => {
        const qc = new QueryCheck({ missing: null });
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test({ other: 1 })).toBe(true);

        qc.setThrowOnUnknownVariable(true);
        expect(() => qc.test({ other: 1 })).toThrow(UnknownVariableException);
    });

    test('testSyntaxErrorInUnreachedBranchThrows: compiled query // syntax errors are reported for the whole query', () => {
        const qc = new QueryCheck({ '$and': [{ myInt: 0 }, { '$unknown': 1 }] });
        expect(() => qc.test(vars)).toThrow(QuerySyntaxError);
        expect(() => qc.test(vars)).toThrow('Unsupported boolean operator: $unknown');
    });

    // testInstanceIsFreedWithoutCycleCollection: not ported (PHP refcount/WeakReference
    // semantics; JS GC is non-deterministic and handles cycles).
});
