'use strict';

const QueryCheck = require('../src/querycheck');

const { StrictTypeError, RegexError, UnknownVariableException } = QueryCheck;
const QuerySyntaxError = QueryCheck.SyntaxError;

function identityOperand(operand) {
    return operand;
}

/**
 * Operand evaluator resolving {$var: "name"} through getVariableValue().
 */
function varEvaluator(operand, data) {
    if (operand !== null && typeof operand === 'object' && !Array.isArray(operand) && typeof operand.$var === 'string') {
        return this.getVariableValue(operand.$var, data);
    }
    return operand;
}

function make(query, { withEvaluator = false, throwOnUnknown = true, strict = false } = {}) {
    const qc = new QueryCheck(query);
    qc.setStrictMode(strict);
    qc.setThrowOnUnknownVariable(throwOnUnknown);
    if (withEvaluator) {
        qc.setOperandEvaluator(identityOperand);
    }
    return qc;
}

/**
 * Calls fn and returns the thrown error (fails if nothing is thrown).
 */
function catchError(fn) {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected an error, none was thrown');
}

function expectExact(fn, Cls, message) {
    const e = catchError(fn);
    expect(e).toBeInstanceOf(Cls);
    expect(e.message).toBe(message);
}

function expectPrefix(fn, Cls, prefix) {
    const e = catchError(fn);
    expect(e).toBeInstanceOf(Cls);
    expect(e.message.startsWith(prefix)).toBe(true);
    return e;
}

function label(value) {
    if (typeof value === 'bigint') {
        return `${value}n`;
    }
    if (typeof value === 'number') {
        return Object.is(value, -0) ? '-0' : String(value);
    }
    if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return typeof value === 'string' ? `'${value}'` : String(value);
}

const codePathProvider = [
    ['no evaluator', false],
    ['identity evaluator', true],
];

// A. Ordering never matches array fields

describe('ordering does not match an array field', () => {
    const arrayFieldOrderingProvider = [
        ['$gt number on list', { v: { $gt: 10 } }, { v: [12, 13] }],
        ['$gte number on list of float', { v: { $gte: 10 } }, { v: [10.0] }],
        ['$lt number on list of float', { v: { $lt: 12 } }, { v: [10.0] }],
        ['$lte number on list', { v: { $lte: 12 } }, { v: [12, 13] }],
        ['split range on list', { v: { $gt: 10, $lt: 13 } }, { v: [5, 20] }],
        ['split range on empty list', { v: { $gt: 10, $lt: 13 } }, { v: [] }],
        ['$expr $gt on list', { $expr: { $gt: ['$v', 10] } }, { v: [12, 13] }],
    ];

    test.each(arrayFieldOrderingProvider)('testOrderingDoesNotMatchArrayField: %s', (_, query, document) => {
        expect(new QueryCheck(query).test(document)).toBe(false);
    });
});

test('[STRICT] ordering an array field throws StrictTypeError', () => {
    const qc = new QueryCheck({ v: { $gt: 10 } });
    qc.setStrictMode(true);
    expect(() => qc.test({ v: [12, 13] })).toThrow(StrictTypeError);
    expect(() => qc.test({ v: [12, 13] })).toThrow('$gt: variable v is of type array while operand is of type number');
});

test('[STRICT] $expr ordering an array field throws StrictTypeError', () => {
    const qc = new QueryCheck({ $expr: { $gt: ['$v', 10] } });
    qc.setStrictMode(true);
    expect(() => qc.test({ v: [12, 13] })).toThrow(StrictTypeError);
    expect(() => qc.test({ v: [12, 13] })).toThrow('$gt: first operand is of type array while second operand is of type number');
});

// B. Specialized closures and generic implementations agree

function outcome(query, document, strict, withEvaluator) {
    const qc = new QueryCheck(query);
    qc.setStrictMode(strict);
    if (withEvaluator) {
        qc.setOperandEvaluator(identityOperand);
    }

    try {
        return qc.test(document) ? 'true' : 'false';
    } catch (e) {
        // the nested path names the field "w.v", the top-level one "v",
        // in the message and in the location prefix ("w.v.$gt: ...")
        const message = e.message.split('variable w.v ').join('variable v ');
        return `${e.name}: ${message.replace(/^w\.v([.:])/, 'v$1')}`;
    }
}

describe('specialized closures agree with generic implementations', () => {
    const values = [
        12, 12.0, 12.1, -0.0, 0, '12', '12.0', '9', '10', 'abc', '', null, true, false,
        [12, 13], ['12'], [], [null], { a: 1 }, NaN, Infinity, -Infinity, 9007199254740993n, 9007199254740992,
    ];
    const operators = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in'];
    const operands = [12, 12.0, '12', '9', 'abc', null, true, NaN, 9007199254740992, [12, 13]];

    const cases = new Map();
    for (const strict of [false, true]) {
        for (const value of values) {
            for (const operator of operators) {
                for (const operand of operands) {
                    const key = `${strict ? 'strict' : 'loose'} ${label(value)} ${operator} ${label(operand)}`;
                    cases.set(key, [key, value, operator, operand, strict]);
                }
            }
        }
    }

    test.each([...cases.values()])('testSpecializedAgreesWithGeneric: %s', (_, value, operator, operand, strict) => {
        const wrapped = operator === '$in' ? [operand] : operand;
        const topLevel = { v: { [operator]: wrapped } };
        const nested = { 'w.v': { [operator]: wrapped } };
        const topDocument = { v: value };
        const nestedDocument = { w: { v: value } };

        const withoutEvaluator = outcome(topLevel, topDocument, strict, false);

        expect({
            'top-level': withoutEvaluator,
            'top-level evaluator': outcome(topLevel, topDocument, strict, true),
            'nested': outcome(nested, nestedDocument, strict, false),
            'nested evaluator': outcome(nested, nestedDocument, strict, true),
        }).toEqual({
            'top-level': withoutEvaluator,
            'top-level evaluator': withoutEvaluator,
            'nested': withoutEvaluator,
            'nested evaluator': withoutEvaluator,
        });
    });
});

// C. Strict-mode rows from the README

test('$ne string vs number // non-strict equal, strict throws like $eq', () => {
    const loose = new QueryCheck({ v: { $ne: 137 } });
    expect(loose.test({ v: '137' })).toBe(false);

    const strict = new QueryCheck({ v: { $ne: 137 } });
    strict.setStrictMode(true);
    expect(() => strict.test({ v: '137' })).toThrow(StrictTypeError);
    expect(() => strict.test({ v: '137' })).toThrow('$ne: variable v is of type string while operand is of type number');
});

describe('[STRICT] $ne mirrors $eq (same exception, opposite result)', () => {
    const values = [137, 137.0, '137', 'abc', null, true, false, [137], ['137'], [], { a: 1 }];
    const cases = new Map();
    for (const value of values) {
        for (const operand of values) {
            const key = `${label(value)} vs ${label(operand)}`;
            cases.set(key, [key, value, operand]);
        }
    }

    test.each([...cases.values()])('testStrictNeMirrorsEq: %s', (_, value, operand) => {
        const run = (operator) => {
            const qc = new QueryCheck({ v: { [operator]: operand } });
            qc.setStrictMode(true);
            try {
                return qc.test({ v: value }) ? 'true' : 'false';
            } catch (e) {
                if (!(e instanceof StrictTypeError)) {
                    throw e;
                }
                return `throws: ${e.message.split('$ne:').join('$eq:')}`;
            }
        };

        const eq = run('$eq');
        const ne = run('$ne');
        if (eq.startsWith('throws')) {
            expect(ne).toBe(eq);
        } else {
            expect(ne).toBe(eq === 'true' ? 'false' : 'true');
        }
    });
});

test('[STRICT] null vs another type // no match, no exception', () => {
    const queries = [
        { v: { $gt: 5 } }, { v: { $gte: 'a' } }, { v: { $lt: true } }, { v: { $lte: 5.5 } },
        { $expr: { $gt: ['$v', 5] } }, { $expr: { $lt: ['$v', 'a'] } },
    ];
    for (const query of queries) {
        const qc = new QueryCheck(query);
        qc.setStrictMode(true);
        expect([JSON.stringify(query), qc.test({ v: null })]).toEqual([JSON.stringify(query), false]);
    }

    // null as the operand
    let qc = new QueryCheck({ v: { $gte: null } });
    qc.setStrictMode(true);
    expect(qc.test({ v: 5 })).toBe(false);

    // $eq / $ne with null never throw either
    qc = new QueryCheck({ v: { $ne: 5 } });
    qc.setStrictMode(true);
    expect(qc.test({ v: null })).toBe(true);
    qc = new QueryCheck({ v: 5 });
    qc.setStrictMode(true);
    expect(qc.test({ v: null })).toBe(false);
});

test('[STRICT] $eq other type mismatch throws StrictTypeError', () => {
    const loose = new QueryCheck({ v: true });
    expect(loose.test({ v: 1 })).toBe(false);

    const strict = new QueryCheck({ v: true });
    strict.setStrictMode(true);
    expect(() => strict.test({ v: 1 })).toThrow(StrictTypeError);
});

test('$in operand that is not a list is a SyntaxError, in both modes', () => {
    for (const strict of [false, true]) {
        const qc = new QueryCheck({ v: { $in: 'x' } });
        qc.setStrictMode(strict);
        expectExact(() => qc.test({ v: 'x' }), QuerySyntaxError, 'v.$in: $in requires an array, got string');
    }
});

test('[STRICT] $in operand from the evaluator that is not a list throws StrictTypeError', () => {
    const qc = new QueryCheck({ v: { $in: { $var: 'list' } } });
    qc.setStrictMode(true);
    qc.setOperandEvaluator(varEvaluator);
    expect(qc.test({ v: 'x', list: ['x', 'y'] })).toBe(true);

    expect(() => qc.test({ v: 'x', list: 'x' })).toThrow(StrictTypeError);
    expect(() => qc.test({ v: 'x', list: 'x' })).toThrow('$in: variable v: operand must be of type array but is of type string');
});

test('[STRICT] ordering a boolean against a number throws StrictTypeError', () => {
    const loose = new QueryCheck({ v: { $gt: 0 } });
    expect(loose.test({ v: true })).toBe(false);

    const strict = new QueryCheck({ v: { $gt: 0 } });
    strict.setStrictMode(true);
    expect(() => strict.test({ v: true })).toThrow(StrictTypeError);
});

test('[STRICT] ordering a numeric string against a number throws StrictTypeError', () => {
    const loose = new QueryCheck({ v: { $gt: 10 } });
    expect(loose.test({ v: '12' })).toBe(true);

    const strict = new QueryCheck({ v: { $gt: 10 } });
    strict.setStrictMode(true);
    expect(() => strict.test({ v: '12' })).toThrow(StrictTypeError);
});

// D. Missing and null fields, on both code paths

describe.each(codePathProvider)('missing and null fields (%s)', (_, withEvaluator) => {
    test('testMissingTopLevelFieldThrows: missing top-level field throws UnknownVariableException', () => {
        const qc = make({ missing: { $gt: 1 } }, { withEvaluator });
        expect(() => qc.test({ v: 1 })).toThrow(UnknownVariableException);
        expect(() => qc.test({ v: 1 })).toThrow("Variable 'missing' is not defined");
    });

    test('testMissingTopLevelFieldIsFalseWhenThrowDisabled: missing top-level field compares as null when throwing is disabled', () => {
        const qc = make({ missing: { $gt: 1 } }, { withEvaluator, throwOnUnknown: false });
        expect(qc.test({ v: 1 })).toBe(false);
    });

    test('testMissingFieldEqualsNull: missing field equals null when setThrowOnUnknownVariable(false)', () => {
        const qc = make({ missing: null }, { withEvaluator, throwOnUnknown: false });
        expect(qc.test({ v: 1 })).toBe(true);
    });

    test('testMissingFieldGteNull: missing field $gte null when setThrowOnUnknownVariable(false)', () => {
        const qc = make({ missing: { $gte: null } }, { withEvaluator, throwOnUnknown: false });
        expect(qc.test({ v: 1 })).toBe(true);
    });

    test('testPresentNullGreaterThanIsFalse: present null does not match $gt and does not throw', () => {
        const qc = make({ v: { $gt: 1 } }, { withEvaluator });
        expect(qc.test({ v: null })).toBe(false);
    });

    test('testPresentNullEqualsNull: present null equals null', () => {
        const qc = make({ v: null }, { withEvaluator });
        expect(qc.test({ v: null })).toBe(true);
    });

    test('testPresentNullLteNull: present null matches $lte null', () => {
        const qc = make({ v: { $lte: null } }, { withEvaluator });
        expect(qc.test({ v: null })).toBe(true);
    });

    test('testNestedMissingFieldThrows: missing nested field throws UnknownVariableException', () => {
        const qc = make({ 'w.missing': 1 }, { withEvaluator });
        expect(() => qc.test({ w: { v: 1 } })).toThrow(UnknownVariableException);
        expect(() => qc.test({ w: { v: 1 } })).toThrow("Variable 'w.missing' is not defined");
    });

    test('testNullIntermediateEqualsNull: null intermediate equals null', () => {
        const qc = make({ 'w.v': null }, { withEvaluator });
        expect(qc.test({ w: null })).toBe(true);
    });

    test('testNullIntermediateGteIsFalse: null intermediate does not match $gte', () => {
        const qc = make({ 'w.v': { $gte: 0 } }, { withEvaluator });
        expect(qc.test({ w: null })).toBe(false);
    });

    test('testArrayIndexOutOfRangeThrows: array index out of range throws UnknownVariableException', () => {
        const qc = make({ 'items[5]': 1 }, { withEvaluator });
        expect(() => qc.test({ items: [1, 2] })).toThrow(UnknownVariableException);
        expect(() => qc.test({ items: [1, 2] })).toThrow("Variable 'items[5]' is not defined");
    });

    test('testArrayIndexOutOfRangeEqualsNull: array index out of range equals null when setThrowOnUnknownVariable(false)', () => {
        const qc = make({ 'items[5]': null }, { withEvaluator, throwOnUnknown: false });
        expect(qc.test({ items: [1, 2] })).toBe(true);
    });

    test('testExprMissingFieldThrows: $expr missing field throws UnknownVariableException', () => {
        const qc = make({ $expr: { $eq: ['$missing', null] } }, { withEvaluator });
        expect(() => qc.test({ v: 1 })).toThrow(UnknownVariableException);
        expect(() => qc.test({ v: 1 })).toThrow("Variable 'missing' is not defined");
    });

    test('testExprMissingFieldEqualsNull: $expr missing field equals null when setThrowOnUnknownVariable(false)', () => {
        const qc = make({ $expr: { $eq: ['$missing', null] } }, { withEvaluator, throwOnUnknown: false });
        expect(qc.test({ v: 1 })).toBe(true);
    });
});

// E. Setters after test() take effect

test('setOperandEvaluator() after test() discards the compiled query', () => {
    const qc = new QueryCheck({ v: { $var: 'x' } });
    const document = { v: 5, x: 5 };
    // without an evaluator, $var is an unknown operator
    expectExact(() => qc.test(document), QuerySyntaxError, 'v: Unsupported query operator: $var');

    qc.setOperandEvaluator(varEvaluator);
    expect(qc.test(document)).toBe(true);
});

test('setStrictMode() after test() discards the compiled query', () => {
    const qc = new QueryCheck({ v: { $gt: 10 } });
    qc.setStrictMode(true);
    expect(() => qc.test({ v: '12' })).toThrow(StrictTypeError);

    qc.setStrictMode(false);
    expect(qc.test({ v: '12' })).toBe(true);
});

// F. Syntax errors come from the first test(), also from unevaluated branches

describe('syntax error is thrown on the first test()', () => {
    const syntaxErrorProvider = [
        ['unknown query operator', { v: { $gt: 1, foo: 2 } }, 'Unsupported query operator: foo'],
        // adapted: a JS array is not an object with integer keys
        ['list as query', [{ v: 1 }], 'Query must be an object'],
        ['empty key', { '': 1 }, 'Empty keys are not supported!'],
        ['$and not a list', { $and: { v: 1 } }, '$and can only operate on arrays of queries'],
        ['$or not a list', { $or: { v: 1 } }, '$or can only operate on arrays of queries'],
        ['$expr requires an object', { $expr: [1, 2] }, '$expr requires an object expression'],
        ['$subtract arity', { $expr: { $subtract: [1, 2, 3] } }, '$subtract requires an array of exactly 2 operands'],
        [
            'unknown aggregation operator in $cond else',
            { $expr: { $cond: { if: true, then: true, else: { $nope: 1 } } } },
            'Unsupported aggregation operator: $nope',
        ],
        [
            'unknown boolean operator in a matching $or branch',
            { $or: [{ v: 1 }, { $nope: 1 }] },
            'Unsupported boolean operator: $nope',
        ],
    ];

    test.each(syntaxErrorProvider)('testSyntaxErrorOnFirstTest: %s', (_, query, message) => {
        const qc = new QueryCheck(query);
        const e = catchError(() => qc.test({ v: 1 }));
        expect(e).toBeInstanceOf(QuerySyntaxError);
        expect(e.message).toContain(message);
    });
});

test('syntax error in $expr is thrown on test() when an operand evaluator is set', () => {
    const qc = new QueryCheck({ $expr: { $eq: [{ $nope: 1 }, 1] } });
    qc.setOperandEvaluator(identityOperand);
    expect(() => qc.test({ v: 1 })).toThrow(QuerySyntaxError);
    expect(() => qc.test({ v: 1 })).toThrow('Unsupported aggregation operator: $nope');
});

// G. $regex

describe('$regex', () => {
    const regexProvider = [
        ['pattern containing slash', { v: { $regex: 'a/b' } }, 'xa/by', true],
        ['$options i', { v: { $regex: '^ab', $options: 'i' } }, 'ABC', true],
        ['without $options', { v: { $regex: '^ab' } }, 'ABC', false],
        ['escaped slash stays escaped', { v: { $regex: 'a\\/b' } }, 'xa/by', true],
        ['escaped backslash before slash', { v: { $regex: 'a\\\\/b' } }, 'xa\\/by', true],
    ];

    test.each(regexProvider)('testRegex: %s', (_, query, value, expected) => {
        expect(make(query).test({ v: value })).toBe(expected);
        expect(make(query, { withEvaluator: true }).test({ v: value })).toBe(expected);
    });
});

// H. getVariableValue

test('getVariableValue resolves paths, indexes and null intermediates', () => {
    const data = { a: { b: 1 }, items: [{ q: 5 }, { q: 20 }], n: null };
    const qc = new QueryCheck({});

    expect(qc.getVariableValue('a.b', data)).toBe(1);
    expect(qc.getVariableValue('items[1].q', data)).toBe(20);
    expect(qc.getVariableValue('n', data)).toBeNull();
    expect(qc.getVariableValue('n.x', data)).toBeNull();
});

test('getVariableValue throws UnknownVariableException for a missing field', () => {
    const qc = new QueryCheck({});
    expect(() => qc.getVariableValue('missing', { a: { b: 1 } })).toThrow(UnknownVariableException);
    expect(() => qc.getVariableValue('missing', { a: { b: 1 } })).toThrow("Variable 'missing' is not defined");
});

test('getVariableValue returns null for a missing field when throwing is disabled', () => {
    const qc = new QueryCheck({});
    qc.setThrowOnUnknownVariable(false);
    expect(qc.getVariableValue('missing', { a: { b: 1 } })).toBeNull();
});

test('getVariableValue throws when walking into a scalar', () => {
    const qc = new QueryCheck({});
    expect(() => qc.getVariableValue('a.b.c', { a: { b: 1 } })).toThrow(UnknownVariableException);
    expect(() => qc.getVariableValue('a.b.c', { a: { b: 1 } })).toThrow("Variable 'a.b.c' is not defined");
});

// I. $not

describe('$not inverts the inner operator', () => {
    const notProvider = [
        ['inverts a non-match', 3, true],
        ['inverts a match', 7, false],
        ['inverts an unorderable value', 'abc', true],
    ];

    test.each(notProvider)('testNotInvertsInnerOperator: %s', (_, value, expected) => {
        const qc = new QueryCheck({ v: { $not: { $gt: 5 } } });
        expect(qc.test({ v: value })).toBe(expected);
    });
});

// J. Objects and lists compare int and float as numbers

describe('objects and lists compare integers and floats as numbers', () => {
    const intFloatCompositeProvider = [
        ['object value', { v: { a: 1 } }, { a: 1.0 }],
        ['list nested in an object', { v: { a: [1, 2] } }, { a: [1.0, 2] }],
        ['$in object element', { v: { $in: [{ x: 1 }] } }, { x: 1.0 }],
        ['list', { v: [1, 2] }, [1.0, 2.0]],
        ['$expr list', { $expr: { $eq: ['$v', [1, 2]] } }, [1.0, 2]],
    ];

    test.each(intFloatCompositeProvider)('testIntFloatCompositeEquality: %s', (_, query, value) => {
        expect(new QueryCheck(query).test({ v: value })).toBe(true);
    });
});

// K. Numeric edge values

describe('numeric edge values agree in both modes', () => {
    const numericEdgeProvider = [
        ['-0.0 equals 0', { v: 0 }, -0.0, true],
        ['-0.0 $ne 0', { v: { $ne: 0 } }, -0.0, false],
        ['INF $gt PHP_INT_MAX', { v: { $gt: 9223372036854775807n } }, Infinity, true],
        ['-INF $lt -1e308', { v: { $lt: -1e308 } }, -Infinity, true],
        ['INF equals INF', { v: Infinity }, Infinity, true],
    ];

    test.each(numericEdgeProvider)('testNumericEdgeValues: %s', (_, query, value, expected) => {
        for (const strict of [false, true]) {
            const qc = new QueryCheck(query);
            qc.setStrictMode(strict);
            expect([strict ? 'strict' : 'non-strict', qc.test({ v: value })])
                .toEqual([strict ? 'strict' : 'non-strict', expected]);
        }
    });
});

// L. validate() and the location in syntax errors

test('validate() accepts a valid query, test() works afterwards', () => {
    const qc = new QueryCheck({
        age: { $gte: 18 },
        $or: [{ role: 'admin' }, { $expr: { $gt: [{ $size: '$tags' }, 1] } }],
    });
    qc.validate();
    qc.validate(); // idempotent

    expect(qc.test({ age: 30, role: 'user', tags: ['a', 'b'] })).toBe(true);
    expect(qc.test({ age: 12, role: 'admin', tags: [] })).toBe(false);
});

describe('validate() throws a SyntaxError with the location', () => {
    const syntaxErrorLocationProvider = [
        ['top-level boolean operator', { $nope: 1 }, '$nope: Unsupported boolean operator: $nope'],
        ['query operator in a field', { age: { $gt: 1, foo: 2 } }, 'age.foo: Unsupported query operator: foo'],
        ['dotted field name', { 'trx.amount': { $gte: 1, bad: 1 } }, 'trx.amount.bad: Unsupported query operator: bad'],
        ['second $or branch', { $or: [{ v: 1 }, { $nope: 1 }] }, '$or[1].$nope: Unsupported boolean operator: $nope'],
        [
            'nested $and / $or / $not',
            { $and: [{ a: 1 }, { $or: [{ b: 1 }, { c: { $not: { $gt: 1, x: 2 } } }] }] },
            '$and[1].$or[1].c.$not.x: Unsupported query operator: x',
        ],
        ['$and not a list', { $and: { v: 1 } }, '$and: $and can only operate on arrays of queries'],
        ['$expr not an object', { $expr: [1, 2] }, '$expr: $expr requires an object expression'],
        ['$expr arity', { $expr: { $subtract: [1, 2, 3] } }, '$expr.$subtract: $subtract requires an array of exactly 2 operands'],
        [
            '$expr $cond branch',
            { $expr: { $cond: { if: true, then: true, else: { $nope: 1 } } } },
            '$expr.$cond.else.$nope: Unsupported aggregation operator: $nope',
        ],
        [
            '$expr deep operand',
            { $expr: { $gt: [{ $add: [1, { $size: { $nope: 1 } }] }, 5] } },
            '$expr.$gt[0].$add[1].$size.$nope: Unsupported aggregation operator: $nope',
        ],
        [
            '$expr $trim input',
            { $expr: { $eq: [{ $trim: { input: { $nope: 1 } } }, 'x'] } },
            '$expr.$eq[0].$trim.input.$nope: Unsupported aggregation operator: $nope',
        ],
        // adapted: a JS array is rejected as a whole, there is no integer key to report
        ['list as query', [{ v: 1 }], 'Query must be an object: [{"v":1}]'],
    ];

    test.each(syntaxErrorLocationProvider)('testValidateThrowsWithLocation: %s', (_, query, message) => {
        const qc = new QueryCheck(query);
        expectExact(() => qc.validate(), QuerySyntaxError, message);

        // test() reports the same error
        expectExact(() => qc.test({ v: 1 }), QuerySyntaxError, message);
    });
});

test('the original error, without location, is kept as previous exception', () => {
    const e = catchError(() => new QueryCheck({ $or: [{ v: 1 }, { $nope: 1 }] }).validate());
    expect(e).toBeInstanceOf(QuerySyntaxError);
    expect(e.cause).toBeInstanceOf(QuerySyntaxError);
    expect(e.cause.message).toBe('Unsupported boolean operator: $nope');
});

test('errors that depend on the document have no location and only come from test()', () => {
    const qc = new QueryCheck({ $expr: { $gt: [{ $add: ['$a', 1] }, 5] } });
    qc.validate();

    expectExact(() => qc.test({ a: 'x' }), QuerySyntaxError, '$add operands must be numeric');
});

test('validate() uses the operand evaluator: custom functions are not syntax errors', () => {
    const query = { $expr: { $gt: [{ $var: 'price' }, 100] } };

    const without = new QueryCheck(query);
    expectExact(() => without.validate(), QuerySyntaxError, '$expr.$gt[0].$var: Unsupported aggregation operator: $var');

    const withEvaluator = new QueryCheck(query);
    withEvaluator.setOperandEvaluator(varEvaluator);
    withEvaluator.validate();
    expect(withEvaluator.test({ price: 150 })).toBe(true);
});

test('with an operand evaluator, parts compiled later still report the location', () => {
    const qc = new QueryCheck({ $expr: { $eq: [{ $nope: 1 }, 1] } });
    qc.setOperandEvaluator(identityOperand);
    qc.validate(); // deferred: the evaluator might resolve {$nope: 1}

    expect(() => qc.test({ v: 1 })).toThrow(QuerySyntaxError);
    expect(() => qc.test({ v: 1 })).toThrow('$expr.$eq[0].$nope: Unsupported aggregation operator: $nope');
});

// M. Compile-time checks

describe('validate() finds mistakes that only the query decides', () => {
    const compileTimeCheckProvider = [
        ['typo in operator, top-level field', { age: { $gtt: 18 } }, 'age: Unsupported query operator: $gtt'],
        ['typo in operator, nested field', { 'a.b': { $gtt: 18 } }, 'a.b: Unsupported query operator: $gtt'],
        ['field then operator', { age: { foo: 1, $gt: 18 } }, 'age: Cannot mix fields and operators in one object: $gt'],
        ['lone $options', { name: { $options: 'i' } }, 'name: $options requires $regex'],
        // the regex engine's own message differs from PCRE: prefix only
        ['invalid pattern', { name: { $regex: '(' } }, 'name.$regex: Invalid $regex pattern "(": ', true],
        ['unknown option', { name: { $regex: 'J', $options: 'e' } }, 'name.$regex: Unsupported $regex option: e (supported: i, m, s, x, u)'],
        ['option is not a string', { name: { $regex: 'J', $options: 1 } }, 'name.$regex: $options requires a string, got number'],
        ['pattern is not a string', { name: { $regex: 12 } }, 'name.$regex: $regex requires a string pattern, got number'],
        ['trailing backslash', { name: { $regex: 'a\\' } }, 'name.$regex: $regex pattern ends with an unescaped backslash'],
        ['invalid pattern inside $not', { name: { $not: { $regex: '(' } } }, 'name.$not.$regex: Invalid $regex pattern "(": ', true],
        ['$in not a list', { age: { $in: 30 } }, 'age.$in: $in requires an array, got number'],
        ['$not with a value', { age: { $not: 30 } }, 'age.$not: $not requires an operator expression like {$not: {$gt: 5}}'],
        ['$not with a plain object', { age: { $not: { x: 1 } } }, 'age.$not: $not requires an operator expression like {$not: {$gt: 5}}'],
        ['empty $and', { $and: [] }, '$and: $and requires a non-empty array'],
        ['empty $or', { $or: [] }, '$or: $or requires a non-empty array'],
        ['ordering against an array', { age: { $gt: [18] } }, 'age.$gt: $gt cannot compare with an array or object'],
        ['ordering against an object', { age: { $lte: { x: 1 } } }, 'age.$lte: $lte cannot compare with an array or object'],
        ['path with empty segment', { 'a..b': 1 }, 'a..b: Invalid field path "a..b": empty segment'],
        ['path "."', { '.': 1 }, '.: Invalid field path ".": empty segment'],
        ['path ending with a dot', { 'a.': 1 }, 'a.: Invalid field path "a.": empty segment'],
        ['$expr field reference "$"', { $expr: { $eq: ['$', 1] } }, '$expr.$eq[0]: Invalid field path "": empty segment'],
        ['$expr field reference with empty segment', { $expr: { $eq: ['$a..b', 1] } }, '$expr.$eq[0]: Invalid field path "a..b": empty segment'],
        ['$expr two operators', { $expr: { $gte: ['$age', 18], $lt: ['$age', 65] } }, '$expr: An operator expression must have exactly one key, found: $gte, $lt'],
        ['$expr nested two operators', { $expr: { $eq: [{ $add: [1], $size: '$x' }, 1] } }, '$expr.$eq[0]: An operator expression must have exactly one key, found: $add, $size'],
        ['$expr typo', { $expr: { gte: ['$age', 18] } }, '$expr: $expr requires an operator expression like {$gt: ["$a", 1]}, got key: gte'],
        ['$expr field then operator', { $expr: { $eq: [{ a: 1, $add: [1] }, 1] } }, '$expr.$eq[0]: Cannot mix fields and operators in one object: $add'],
        ['$divide by literal 0', { $expr: { $gt: [{ $divide: ['$a', 0] }, 1] } }, '$expr.$gt[0].$divide: $divide: division by zero'],
        ['$mod by literal 0.0', { $expr: { $eq: [{ $mod: ['$a', 0.0] }, 1] } }, '$expr.$eq[0].$mod: $mod: division by zero'],
    ];

    test.each(compileTimeCheckProvider)('testCompileTimeCheck: %s', (_, query, message, prefixOnly = false) => {
        const qc = new QueryCheck(query);
        if (prefixOnly) {
            expectPrefix(() => qc.validate(), QuerySyntaxError, message);
        } else {
            expectExact(() => qc.validate(), QuerySyntaxError, message);
        }
    });
});

describe('valid queries pass validate()', () => {
    const stillValidProvider = [
        ['object equality', { o: { x: 1, y: 2 } }, { o: { x: 1, y: 2 } }, true],
        ['escaped dot in path', { 'a\\.b': 1 }, { 'a\\.b': 1 }, true],
        ['array index path', { 'items[1]': 2 }, { items: [1, 2] }, true],
        ['$not with $regex', { name: { $not: { $regex: '^J' } } }, { name: 'Ann' }, true],
        ['$regex with every option', { name: { $regex: '^j o', $options: 'imsxu' } }, { name: 'John' }, true],
        ['$regex with an escaped slash', { name: { $regex: 'a\\/b' } }, { name: 'a/b' }, true],
        ['$expr literal object as value', { $expr: { $eq: ['$o', { x: 1 }] } }, { o: { x: 1 } }, true],
        ['$expr non-boolean result counts as true', { $expr: { $add: ['$a', 1] } }, { a: 5 }, true],
        [
            '$cond with a null branch',
            { $expr: { $eq: [{ $cond: { if: false, then: 1, else: null } }, null] } },
            { v: 1 },
            true,
        ],
        ['$divide by a field', { $expr: { $gt: [{ $divide: ['$a', '$b'] }, 1] } }, { a: 4, b: 2 }, true],
    ];

    test.each(stillValidProvider)('testStillValid: %s', (_, query, document, expected) => {
        const qc = new QueryCheck(query);
        qc.validate();
        expect(qc.test(document)).toBe(expected);
    });
});

test('with an operand evaluator, unknown $ keys in a field condition are custom functions', () => {
    const qc = new QueryCheck({ v: { $var: 'x' }, w: { a: 1, $var: 'y' } });
    qc.setOperandEvaluator(varEvaluator);
    qc.validate();
    expect(qc.test({ v: 5, x: 5, w: 7, y: 7 })).toBe(true);
});

test('with an operand evaluator, a literal operand is checked when the evaluator returns it unchanged', () => {
    const qc = new QueryCheck({ $or: [{ a: 1 }, { age: { $gt: [18] } }] });
    qc.setOperandEvaluator(identityOperand);
    qc.validate(); // deferred: the evaluator might resolve [18]
    expect(qc.test({ a: 1, age: 30 })).toBe(true); // second branch not reached

    expect(() => qc.test({ a: 2, age: 30 })).toThrow(QuerySyntaxError);
    expect(() => qc.test({ a: 2, age: 30 })).toThrow('$or[1].age.$gt: $gt cannot compare with an array or object');
});

test('with an operand evaluator, an invalid $regex pattern throws at test() with the location', () => {
    const qc = new QueryCheck({ name: { $regex: { $var: 'pattern' } } });
    qc.setOperandEvaluator(varEvaluator);
    expect(qc.test({ name: 'John', pattern: '^J' })).toBe(true);

    expectPrefix(() => qc.test({ name: 'John', pattern: '(' }), QuerySyntaxError, 'name.$regex: Invalid $regex pattern "(": ');
});

// adapted: JavaScript's RegExp has no backtrack limit and no UTF-8 errors, so
// a failure while matching is simulated by a RegExp.prototype.test that throws
test('a $regex that fails while matching throws RegexError, also under $not', () => {
    const cases = [
        ['matching fails', { v: { $regex: '^(a+)+$' } }],
        ['matching fails under $not', { v: { $not: { $regex: '^(a+)+$' } } }],
        ['matching fails under $not with option u', { v: { $not: { $regex: '^(a+)+$', $options: 'u' } } }],
    ];
    const originalTest = RegExp.prototype.test;
    const spy = jest.spyOn(RegExp.prototype, 'test').mockImplementation(function (subject) {
        if (this.source === '^(a+)+$') {
            throw new RangeError('Maximum call stack size exceeded');
        }
        return originalTest.call(this, subject);
    });
    try {
        for (const [caseLabel, query] of cases) {
            for (const withEvaluator of [false, true]) {
                const e = catchError(() => make(query, { withEvaluator }).test({ v: `${'a'.repeat(40)}b` }));
                expect([caseLabel, e instanceof RegexError]).toEqual([caseLabel, true]);
                expect(e.message.startsWith('$regex: matching variable v failed: ')).toBe(true);
                expect(e.message).toContain('Maximum call stack size exceeded');
                expect(e.cause).toBeInstanceOf(RangeError);
            }
        }
    } finally {
        spy.mockRestore();
    }
});

describe('$regex on non-strings: numbers as text without strict mode, otherwise no match; strict mode throws', () => {
    // value, non-strict result, strict exception message (null: same result as non-strict)
    const regexValueProvider = [
        ['string', '12a', true, null],
        ['integer', 12, true, '$regex: variable v is of type number while a string is expected'],
        ['float', 12.5, true, '$regex: variable v is of type number while a string is expected'],
        ['null', null, false, null],
        ['boolean', true, false, '$regex: variable v is of type boolean while a string is expected'],
        ['array', ['12'], false, '$regex: variable v is of type array while a string is expected'],
        ['NaN', NaN, false, '$regex: variable v is of type number while a string is expected'],
    ];

    test.each(regexValueProvider)('testRegexValueTypes: %s', (_, value, expected, strictMessage) => {
        const query = { v: { $regex: '^1' } };
        expect(new QueryCheck(query).test({ v: value })).toBe(expected);

        const strict = new QueryCheck(query);
        strict.setStrictMode(true);
        if (strictMessage === null) {
            expect(strict.test({ v: value })).toBe(expected);
            return;
        }
        expect(() => strict.test({ v: value })).toThrow(StrictTypeError);
        expect(() => strict.test({ v: value })).toThrow(strictMessage);
    });
});

test('a setter after validate() discards the compiled query', () => {
    const qc = new QueryCheck({ v: { $gt: 10 } });
    qc.validate();
    expect(qc.test({ v: '12' })).toBe(true);

    qc.setStrictMode(true);
    qc.validate();
    expect(() => qc.test({ v: '12' })).toThrow(StrictTypeError);
});
