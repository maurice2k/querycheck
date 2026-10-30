'use strict';

const QueryCheck = require('../src/querycheck.js');

describe('README examples', () => {

    test('simple example', () => {
        const openingHours = new QueryCheck({
            'now.isoDate': { $not: { $in: ['2019-12-25', '2019-12-26', '2019-12-31', '2020-01-01'] } },
            'now.isoTime': { $gt: '10:00', $lt: '18:00' },
        });
        expect(openingHours.test({ now: { isoDate: '2020-05-21', isoTime: '13:59:48' } })).toBe(true);
        expect(openingHours.test({ now: { isoDate: '2019-12-25', isoTime: '13:59:48' } })).toBe(false);
        expect(openingHours.test({ now: { isoDate: '2020-05-21', isoTime: '09:59:48' } })).toBe(false);
    });

    test('$expr examples', () => {
        expect(new QueryCheck({ $expr: { $gt: ['$spent', '$budget'] } }).test({ spent: 450, budget: 400 })).toBe(true);

        expect(new QueryCheck({ $expr: { $gte: [{ $add: ['$subtotal', '$tax', '$shipping'] }, 100] } })
            .test({ subtotal: 80, tax: 10, shipping: 15 })).toBe(true);

        expect(new QueryCheck({
            $expr: {
                $lt: [
                    {
                        $cond: {
                            if: { $gte: ['$qty', 100] },
                            then: { $multiply: ['$price', 0.5] },
                            else: { $multiply: ['$price', 0.75] },
                        },
                    },
                    60,
                ],
            },
        }).test({ qty: 150, price: 100 })).toBe(true);

        expect(new QueryCheck({ $expr: { $not: [{ $gt: ['$qty', 250] }] } }).test({ qty: 200 })).toBe(true);

        expect(new QueryCheck({ $expr: { $in: ['$fruit', '$in_stock'] } })
            .test({ fruit: 'banana', in_stock: ['apple', 'banana', 'cherry'] })).toBe(true);

        expect(new QueryCheck({ $expr: { $not: [{ $in: ['$category', '$restricted_categories'] }] } })
            .test({ category: 'electronics', restricted_categories: ['weapons', 'alcohol'] })).toBe(true);
    });

    test('$literal keeps user input that starts with $', () => {
        const userInput = '$role';
        const qc = new QueryCheck({ $expr: { $eq: ['$price', { $literal: userInput }] } });
        expect(qc.test({ price: '$role', role: 'x' })).toBe(true);
        expect(qc.test({ price: 'x', role: 'x' })).toBe(false);
        expect(new QueryCheck({ $expr: { $eq: ['$v', { $literal: { $add: [2, 3] } }] } }).test({ v: { $add: [2, 3] } })).toBe(true);
    });

    test('aggregation $not falsy values', () => {
        for (const value of [false, null, 0, 0n]) {
            expect(new QueryCheck({ $expr: { $not: ['$v'] } }).test({ v: value })).toBe(true);
        }
        for (const value of [true, 1, -1, 1n, [], [false], 'x', '']) {
            expect(new QueryCheck({ $expr: { $not: ['$v'] } }).test({ v: value })).toBe(false);
        }
    });

    test('numbers and BigInts are one type', () => {
        expect(new QueryCheck({ v: 12 }).test({ v: 12n })).toBe(true);
        expect(new QueryCheck({ v: 9007199254740992 }).test({ v: 9007199254740993n })).toBe(false);
        expect(new QueryCheck({ v: { $gt: 9007199254740992 } }).test({ v: 9007199254740993n })).toBe(true);
    });

    test('equality rules', () => {
        expect(new QueryCheck({ v: NaN }).test({ v: NaN })).toBe(true);
        expect(new QueryCheck({ v: 137 }).test({ v: '137' })).toBe(true);
        expect(new QueryCheck({ v: 137 }).test({ v: '137.0' })).toBe(false);
        expect(new QueryCheck({ v: new Date('2020-01-01') }).test({ v: new Date('2020-01-01') })).toBe(true);
        expect(new QueryCheck({ v: new Date('2020-01-01') }).test({ v: new Date('2020-01-02') })).toBe(false);
    });

    test('ordering table', () => {
        const ordered = (value, operator, operand) => new QueryCheck({ v: { [operator]: operand } }).test({ v: value });
        expect(ordered('10', '$lt', '9')).toBe(true);
        expect(ordered('12.0', '$gt', '12')).toBe(true);
        expect(ordered('9:00', '$gt', '10:00')).toBe(true);
        expect(ordered(true, '$gt', false)).toBe(true);
        expect(ordered(null, '$gte', null)).toBe(true);
        expect(ordered(null, '$lte', null)).toBe(true);
        expect(ordered(new Date('2020-01-02'), '$gt', new Date('2020-01-01'))).toBe(true);
        expect(ordered(137, '$gt', '136')).toBe(true);
        expect(ordered('137', '$gt', '136')).toBe(true);
        expect(ordered('20', '$gt', '136')).toBe(true);
        expect(ordered('137', '$gt', 136)).toBe(true);
        expect(ordered('1e2', '$gte', 100)).toBe(true);
        expect(ordered(' 12 ', '$gte', 12)).toBe(true);
        expect(ordered('0x10', '$gt', 1)).toBe(false);
        expect(ordered('Infinity', '$gt', 1)).toBe(false);
        expect(ordered(NaN, '$gt', 1)).toBe(false);
        expect(ordered(NaN, '$lt', 1)).toBe(false);
        expect(ordered(NaN, '$gte', NaN)).toBe(true);
        expect(ordered('admin', '$gte', 18)).toBe(false);
        expect(ordered(true, '$gte', 0)).toBe(false);
        expect(ordered('\u{1F600}', '$gt', '\uFFFF')).toBe(true);

        let qc = new QueryCheck({ age: { $gte: 18 } });
        expect(qc.test({ age: 30 })).toBe(true);
        expect(qc.test({ age: 'admin' })).toBe(false);
        expect(qc.test({ age: [] })).toBe(false);

        qc = new QueryCheck({ failedAttempts: { $lt: 5 } });
        expect(qc.test({ failedAttempts: null })).toBe(false);

        expect(new QueryCheck({ v: { $gt: 9 } }).test({ v: '10' })).toBe(true);
        expect(new QueryCheck({ v: { $gt: '9' } }).test({ v: '10' })).toBe(false);
        expect(new QueryCheck({ age: { $not: { $gte: 18 } } }).test({ age: 'admin' })).toBe(true);
    });

    test('array fields table', () => {
        const rows = [
            [{ role: 'admin' }, [true, false, false]],
            [{ role: { $ne: 'admin' } }, [false, true, true]],
            [{ role: { $in: ['admin', 'owner'] } }, [true, false, false]],
            [{ role: { $not: { $in: ['admin'] } } }, [false, true, true]],
        ];
        for (const [query, expected] of rows) {
            const qc = new QueryCheck(query);
            expect([['user', 'admin'], ['user'], []].map((role) => qc.test({ role }))).toEqual(expected);
        }

        expect(new QueryCheck({ role: { $ne: 'banned' } }).test({ role: ['banned', 'admin'] })).toBe(false);
        expect(new QueryCheck({ tags: ['a', 'b'] }).test({ tags: ['a', 'b'] })).toBe(true);
        expect(new QueryCheck({ tags: { $in: [['a', 'b']] } }).test({ tags: ['a', 'b'] })).toBe(true);
        expect(new QueryCheck({ tags: ['a'] }).test({ tags: ['a', 'b'] })).toBe(false);
        expect(new QueryCheck({ v: null }).test({ v: [null] })).toBe(true);
        expect(new QueryCheck({ v: { $gt: 1 } }).test({ v: [5] })).toBe(false);
    });

    test('strict mode table', () => {
        const strict = (query, value) => {
            const qc = new QueryCheck(query);
            qc.setStrictMode(true);
            return () => qc.test({ v: value });
        };
        const loose = (query, value) => new QueryCheck(query).test({ v: value });

        const qc = new QueryCheck({ age: '30' });
        qc.setStrictMode(true);
        expect(() => qc.test({ age: 30 })).toThrow(QueryCheck.StrictTypeError);

        expect(loose({ v: 137 }, '137')).toBe(true);
        expect(strict({ v: 137 }, '137')).toThrow(QueryCheck.StrictTypeError);
        expect(loose({ v: { $ne: 137 } }, '137')).toBe(false);
        expect(strict({ v: { $ne: 137 } }, '137')).toThrow(QueryCheck.StrictTypeError);
        expect(loose({ v: true }, 1)).toBe(false);
        expect(loose({ v: { $ne: true } }, 1)).toBe(true);
        expect(strict({ v: true }, 1)).toThrow(QueryCheck.StrictTypeError);
        expect(strict({ v: null }, 1)()).toBe(false);
        expect(strict({ v: { $ne: null } }, 1)()).toBe(true);
        expect(strict({ v: { $in: ['137'] } }, 137)()).toBe(false);
        expect(strict({ v: '137' }, [137])()).toBe(false);
        expect(strict({ $expr: { $eq: ['$v', '137'] } }, 137)()).toBe(false);
        expect(loose({ $expr: { $eq: ['$v', '137'] } }, 137)).toBe(true);
        expect(strict({ v: { $gt: 1 } }, '2')).toThrow(QueryCheck.StrictTypeError);
        expect(strict({ $expr: { $gt: ['$v', 1] } }, '2')).toThrow(QueryCheck.StrictTypeError);
        expect(strict({ v: { $gte: 1000 } }, null)()).toBe(false);
        expect(loose({ v: { $regex: '^1' } }, 12)).toBe(true);
        expect(loose({ v: { $regex: 'true' } }, true)).toBe(false);
        expect(strict({ v: { $regex: '^1' } }, 12)).toThrow(QueryCheck.StrictTypeError);
        expect(strict({ v: { $regex: '^1' } }, null)()).toBe(false);

        const nonObject = new QueryCheck({ v: 1 });
        expect(nonObject.test([1])).toBe(false);
        nonObject.setStrictMode(true);
        expect(() => nonObject.test('x')).toThrow(QueryCheck.StrictTypeError);
    });

    test('missing fields', () => {
        const qc = new QueryCheck({ nonExistent: null });
        expect(() => qc.test({ someKey: 'value' })).toThrow(QueryCheck.UnknownVariableException);
        qc.setThrowOnUnknownVariable(false);
        expect(qc.test({ someKey: 'value' })).toBe(true);

        expect(new QueryCheck({ 'profile.age': null }).test({ profile: null })).toBe(true);
        expect(new QueryCheck({ 'items.0': 'a' }).test({ items: ['a'] })).toBe(true);
        expect(new QueryCheck({ 'items[0]': 'a' }).test({ items: ['a'] })).toBe(true);
        expect(() => new QueryCheck({ 'items.length': 1 }).test({ items: ['a'] })).toThrow(QueryCheck.UnknownVariableException);
        expect(() => new QueryCheck({ toString: { $ne: null } }).test({})).toThrow(QueryCheck.UnknownVariableException);
    });

    test('compiled queries: error locations', () => {
        expect(() => new QueryCheck({ $or: [{ a: 1 }, { age: { $not: { foo: 1 } } }] }).validate())
            .toThrow('$or[1].age.$not: $not requires an operator expression like {$not: {$gt: 5}}');
        expect(() => new QueryCheck({ $expr: { $gt: [{ $add: [1, { $size: { $nope: 1 } }] }, 1] } }).validate())
            .toThrow('$expr.$gt[0].$add[1].$size.$nope: Unsupported aggregation operator: $nope');

        const qc = new QueryCheck({ age: { $gtt: 18 } });
        qc.setStrictMode(true);
        expect(() => qc.validate()).toThrow(QueryCheck.SyntaxError);
    });

    test('compiled queries: compile-time checks table', () => {
        const cases = [
            [{ age: { $gtt: 18 } }, 'age: Unsupported query operator: $gtt'],
            [{ age: { foo: 1, $gt: 18 } }, 'age: Cannot mix fields and operators in one object: $gt'],
            [{ name: { $options: 'i' } }, 'name: $options requires $regex'],
            [{ name: { $regex: '(' } }, 'name.$regex: Invalid $regex pattern "(": '],
            [{ name: { $regex: 'a', $options: 'e' } }, 'name.$regex: Unsupported $regex option: e (supported: i, m, s, x, u)'],
            [{ name: { $regex: 12 } }, 'name.$regex: $regex requires a string pattern, got number'],
            [{ name: { $regex: 'a\\' } }, 'name.$regex: $regex pattern ends with an unescaped backslash'],
            [{ age: { $in: 30 } }, 'age.$in: $in requires an array, got number'],
            [{ age: { $not: 30 } }, 'age.$not: $not requires an operator expression like {$not: {$gt: 5}}'],
            [{ age: { $gt: [18] } }, 'age.$gt: $gt cannot compare with an array or object'],
            [{ $and: [] }, '$and: $and requires a non-empty array'],
            [{ $or: [] }, '$or: $or requires a non-empty array'],
            [{ 'a..b': 1 }, 'a..b: Invalid field path "a..b": empty segment'],
            [{ '.': 1 }, '.: Invalid field path ".": empty segment'],
            [{ $expr: { $eq: ['$', 1] } }, '$expr.$eq[0]: Invalid field path "": empty segment'],
            [{ $expr: { gte: ['$a', 1] } }, '$expr: $expr requires an operator expression like {$gt: ["$a", 1]}, got key: gte'],
            [{ $expr: { $gte: ['$a', 1], $lt: ['$a', 5] } }, '$expr: An operator expression must have exactly one key, found: $gte, $lt'],
            [{ $expr: { $gt: [{ $divide: ['$a', 0] }, 1] } }, '$expr.$gt[0].$divide: $divide: division by zero'],
        ];
        for (const [query, message] of cases) {
            expect(() => new QueryCheck(query).validate()).toThrow(message);
        }
    });

    test('regex failure while matching is a RegexError', () => {
        const qc = new QueryCheck({ v: { $not: { $regex: '^qc-fail$' } } });
        const original = RegExp.prototype.test;
        const spy = jest.spyOn(RegExp.prototype, 'test').mockImplementation(function (subject) {
            if (this.source === '^qc-fail$') {
                throw new RangeError('Maximum call stack size exceeded');
            }
            return original.call(this, subject);
        });
        try {
            expect(() => qc.test({ v: 'a' })).toThrow(QueryCheck.RegexError);
        } finally {
            spy.mockRestore();
        }
    });

    test('regex x option strips whitespace and comments', () => {
        expect(new QueryCheck({ v: { $regex: '^a b # comment\n c$', $options: 'x' } }).test({ v: 'abc' })).toBe(true);
        expect(new QueryCheck({ v: { $regex: '^a[ ]b$', $options: 'x' } }).test({ v: 'a b' })).toBe(true);
        expect(new QueryCheck({ v: { $regex: '^a\\ b$', $options: 'x' } }).test({ v: 'a b' })).toBe(true);
        expect(new QueryCheck({ v: { $regex: '^[]a]+$', $options: 'x' } }).test({ v: ']a' })).toBe(true);
    });

    test('short-circuit evaluation', () => {
        const qc = new QueryCheck({
            $or: [
                { $expr: { $eq: [{ $size: '$items' }, 0] } },
                { 'items[0].status': 'paid' },
            ],
        });
        expect(qc.test({ items: [] })).toBe(true);
        expect(qc.test({ items: [{ status: 'paid' }] })).toBe(true);
    });

    test('custom operand evaluator', () => {
        const evaluator = function evaluate(operand, data) {
            if (operand !== null && typeof operand === 'object' && '$var' in operand) {
                return this.getVariableValue(operand.$var, data);
            }
            if (operand !== null && typeof operand === 'object' && '$concat' in operand) {
                return operand.$concat
                    .map((item) => (typeof item === 'string' ? item : evaluate.call(this, item, data)))
                    .join('');
            }
            return operand;
        };

        let qc = new QueryCheck({ fullName: { $concat: [{ $var: 'firstName' }, ' ', { $var: 'lastName' }] } });
        qc.setOperandEvaluator(evaluator);
        expect(qc.test({ fullName: 'John Doe', firstName: 'John', lastName: 'Doe' })).toBe(true);
        expect(qc.test({ fullName: 'Jane Doe', firstName: 'John', lastName: 'Doe' })).toBe(false);

        qc = new QueryCheck({ $expr: { $gt: [{ $multiply: [{ $var: 'price' }, { $var: 'multiplier' }] }, 150] } });
        qc.setOperandEvaluator(evaluator);
        expect(qc.test({ price: 100, multiplier: 2 })).toBe(true);
        expect(qc.test({ price: 100, multiplier: 1 })).toBe(false);
    });

    test('errors table', () => {
        const syntax = (() => { try { new QueryCheck({ $foo: 1 }).validate(); } catch (e) { return e; } })();
        expect(syntax).toBeInstanceOf(QueryCheck.QuerySyntaxError);
        expect(syntax).toBeInstanceOf(QueryCheck.SyntaxError);
        expect(syntax).toBeInstanceOf(SyntaxError);
        expect(syntax).toBeInstanceOf(QueryCheck.QueryCheckError);

        const add = new QueryCheck({ $expr: { $gt: [{ $add: ['$v', 1] }, 1] } });
        expect(() => add.test({ v: 'x' })).toThrow(QueryCheck.SyntaxError);

        const strict = new QueryCheck({ v: 1 });
        strict.setStrictMode(true);
        const typeError = (() => { try { strict.test({ v: 'x' }); } catch (e) { return e; } })();
        expect(typeError).toBeInstanceOf(TypeError);
        expect(typeError).toBeInstanceOf(QueryCheck.QueryCheckError);

        expect(new QueryCheck.RegexError('x')).toBeInstanceOf(QueryCheck.QueryCheckError);
        expect(new QueryCheck.UnknownVariableException('x')).toBeInstanceOf(QueryCheck.QueryCheckError);
        expect(new Error('x')).not.toBeInstanceOf(QueryCheck.QueryCheckError);

        const located = (() => { try { new QueryCheck({ a: { $gtt: 1 } }).validate(); } catch (e) { return e; } })();
        expect(located.message).toBe('a: Unsupported query operator: $gtt');
        expect(located.cause.message).toBe('Unsupported query operator: $gtt');
    });
});
