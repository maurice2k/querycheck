'use strict';

const {
    QuerySyntaxError,
    StrictTypeError,
    RegexError,
    UnknownVariableException,
} = require('./errors');

/**
 * Query operators. Used to tell {age: {$gt: 1}} (operator expression) apart
 * from {address: {city: "Berlin"}} (object compared with $eq).
 */
const QUERY_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$regex', '$options', '$not']);

/** @type {Record<string, (cmp: number) => boolean>} */
const ORDER_TESTS = {
    '$gt': (cmp) => cmp > 0,
    '$gte': (cmp) => cmp >= 0,
    '$lt': (cmp) => cmp < 0,
    '$lte': (cmp) => cmp <= 0,
};

/** Data passed to the expression negated by the query $not, as before. */
const EMPTY = Object.freeze({});

/** A path segment that does not exist. */
const MISSING = Symbol('missing');

const NUMERIC_STRING = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;
const DEFAULT_TRIM_CHARS = new Set([' ', '\t', '\n', '\r', '\0', '\x0B']);

const hasOwn = Object.hasOwn;

/**
 * @typedef {(data: Record<string, any>) => boolean} QueryNode
 * @typedef {(value: any, data: Record<string, any>) => boolean} FieldTest
 * @typedef {(data: Record<string, any>) => any} AggNode
 * @typedef {{key: string|number, idx: number}} Segment
 */

/**
 * Compiles a query into a tree of closures.
 *
 * Everything that only depends on the query is decided here, once: which
 * operator a key is, shorthand forms like {age: 37}, field path parsing,
 * operator arity and the type of a literal operand. The returned closures
 * only look at the document.
 *
 * Three kinds of closures are built:
 *
 * - query nodes:       (data) => boolean         ($and, $or, fields, $expr)
 * - field operators:   (value, data) => boolean  ($eq, $gt, $regex, ...)
 * - aggregation nodes: (data) => any             (everything inside $expr)
 *
 * The settings are fixed for the lifetime of a compiler. QueryCheck creates a
 * new one, and recompiles, whenever a setting changes.
 *
 * @internal used by QueryCheck, not part of the public API
 */
class Compiler {
    /**
     * @param {boolean} strictMode
     * @param {boolean} throwOnUnknownVariable
     * @param {((operand: any, data: object) => any)|null} operandEvaluator
     */
    constructor(strictMode, throwOnUnknownVariable, operandEvaluator) {
        this.strictMode = strictMode;
        this.throwOnUnknownVariable = throwOnUnknownVariable;
        this.operandEvaluator = operandEvaluator;

        /**
         * Where the compiler currently is in the query, for error messages,
         * e.g. ['$or', 1, 'age', '$gt']. A step is only removed after it
         * compiled, so when a SyntaxError is thrown the path still points to
         * its location. Only recorded while track is on.
         *
         * @type {Array<string|number>}
         */
        this.path = [];

        /**
         * Whether path is recorded. Off for a normal compile, which then
         * costs nothing extra; compileQuery() compiles a second time with it
         * on only to find the location of a SyntaxError. Always on with an
         * operand evaluator, because parts compiled later need the location
         * of their place in the query.
         */
        this.track = operandEvaluator !== null;
    }

    /**
     * Compiles a whole query. A SyntaxError gets the location of the error
     * as a prefix, e.g. "$or[1].age.$gtt: Unsupported query operator: $gtt".
     *
     * @param {any} query
     * @returns {QueryNode}
     */
    compileQuery(query) {
        let error;
        try {
            return this.compileAt([], () => this.compileQueryNode(query));
        } catch (e) {
            if (!(e instanceof QuerySyntaxError) || this.track) {
                throw e;
            }
            error = e;
        }

        // Compiling has no side effects, so a second pass that records the
        // path fails at the same place, this time with the location.
        this.track = true;
        try {
            this.compileAt([], () => this.compileQueryNode(query));
        } finally {
            this.track = false;
        }
        throw error; // not reached: the second pass throws
    }

    /**
     * Runs a compile step starting at `at` and adds the location to a
     * SyntaxError. Also used for parts that are compiled later, at runtime
     * (with an operand evaluator).
     *
     * @template T
     * @param {Array<string|number>} at
     * @param {() => T} compile
     * @returns {T}
     */
    compileAt(at, compile) {
        this.path = at.slice();
        let result;
        try {
            result = compile();
        } catch (e) {
            if (!(e instanceof QuerySyntaxError)) {
                this.path = [];
                throw e;
            }
            const location = formatPath(this.path);
            this.path = [];
            throw location === '' ? e : new QuerySyntaxError(`${location}: ${e.message}`, { cause: e });
        }
        this.path = [];
        return result;
    }

    // ------------------------------------------------------------------
    // Query nodes: (data) => boolean
    // ------------------------------------------------------------------

    /**
     * @param {any} query
     * @returns {QueryNode}
     */
    compileQueryNode(query) {
        if (query === null || typeof query !== 'object' || Array.isArray(query)) {
            throw new QuerySyntaxError(`Query must be an object: ${stringify(query)}`);
        }

        const keys = Object.keys(query);

        if (keys.length === 0) {
            // empty query is always valid
            return () => true;
        }

        if (keys.length === 1) {
            return this.compileEntry(keys[0], query[keys[0]]);
        }

        // implicit $and: {age: 37, name: "John"} is
        // {$and: [{age: 37}, {name: "John"}]}
        const children = new Array(keys.length);
        for (let i = 0; i < keys.length; ++i) {
            children[i] = this.compileEntry(keys[i], query[keys[i]]);
        }
        return all(children);
    }

    /**
     * One {key: value} entry of a query object.
     *
     * @param {string} key
     * @param {any} value
     * @returns {QueryNode}
     */
    compileEntry(key, value) {
        if (this.track) {
            this.path.push(key);
        }

        if (key === '') {
            throw new QuerySyntaxError('Empty keys are not supported!');
        }

        let node;
        if (key[0] === '$') {
            // "key" must be a boolean operator like $and/$or, "value" the
            // sub queries
            switch (key) {
                case '$or': node = this.compileOr(value); break;
                case '$and': node = this.compileAnd(value); break;
                case '$expr': node = this.compileExpr(value); break;
                default: throw new QuerySyntaxError(`Unsupported boolean operator: ${key}`);
            }
        } else {
            // "key" is a variable name; "value" the expression (or a set of
            // expressions) to evaluate against it
            node = this.compileField(key, value);
        }

        if (this.track) {
            this.path.pop();
        }
        return node;
    }

    /**
     * Evaluates the $or logical operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/or/
     *
     * Syntax: { $or: [ <expression1>, <expression2>, ... ] }
     *
     * Short-circuits like $and: evaluation stops at the first matching
     * branch, in the order given, so later branches are not evaluated (and
     * cannot throw) once one matched.
     *
     * @param {any} query
     * @returns {QueryNode}
     */
    compileOr(query) {
        const children = this.compileQueryList(query, '$or');

        if (children.length === 1) {
            return children[0];
        }

        return (data) => {
            for (let i = 0; i < children.length; ++i) {
                if (children[i](data)) {
                    return true;
                }
            }
            return false;
        };
    }

    /**
     * Evaluates the $and logical operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/and/
     *
     * Syntax: { $and: [ <expression1>, <expression2>, ... ] }
     *
     * @param {any} query
     * @returns {QueryNode}
     */
    compileAnd(query) {
        return all(this.compileQueryList(query, '$and'));
    }

    /**
     * @param {any} query
     * @param {string} operator
     * @returns {QueryNode[]}
     */
    compileQueryList(query, operator) {
        if (!Array.isArray(query)) {
            throw new QuerySyntaxError(`${operator} can only operate on arrays of queries`);
        }

        if (query.length === 0) {
            throw new QuerySyntaxError(`${operator} requires a non-empty array`);
        }

        const children = [];
        for (let i = 0; i < query.length; ++i) {
            if (this.track) {
                this.path.push(i);
            }
            children.push(this.compileQueryNode(query[i]));
            if (this.track) {
                this.path.pop();
            }
        }
        return children;
    }

    /**
     * A field condition: reads the field from the document, then runs the
     * field operators on it.
     *
     * Shortcut styles:
     *   {age: 37}                 is {age: {$eq: 37}}
     *   {age: null}               is {age: {$eq: null}}
     *   {age: {$gt: 30, $lt: 40}} runs both operators
     *
     * @param {string} variableName
     * @param {any} expression
     * @returns {QueryNode}
     */
    compileField(variableName, expression) {
        const plain = isPlainName(variableName);
        const segments = plain ? null : parseFieldPath(variableName);
        const test = this.compileFieldExpression(variableName, expression);

        if (plain) {
            // a plain top-level field like "age": read and test in one closure
            const key = variableName;
            return (data) => {
                if (hasOwn(data, key)) {
                    const value = data[key];
                    if (value !== undefined) {
                        return test(value, data);
                    }
                }
                return test(this.unknownVariable(variableName), data);
            };
        }

        const resolve = this.compilePath(variableName, /** @type {Segment[]} */ (segments));
        return (data) => test(resolve(data), data);
    }

    /**
     * Evaluates the $expr operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/expr/
     *
     * Syntax: { $expr: { <expression> } }
     *
     * @param {any} expression
     * @returns {QueryNode}
     */
    compileExpr(expression) {
        if (!isPlainObject(expression)) {
            throw new QuerySyntaxError('$expr requires an object expression');
        }

        const first = Object.keys(expression)[0];
        if (this.operandEvaluator === null && (first === undefined || first[0] !== '$')) {
            // a plain object counts as true, so a typo like {gte: [...]}
            // would match every document
            throw new QuerySyntaxError(`$expr requires an operator expression like {$gt: ["$a", 1]}, got key: ${first ?? ''}`);
        }

        const node = this.compileAgg(expression);

        return (data) => toBool(node(data));
    }

    // ------------------------------------------------------------------
    // Field paths
    // ------------------------------------------------------------------

    /**
     * @param {string} variableName
     * @param {Segment[]} segments
     * @returns {AggNode}
     */
    compilePath(variableName, segments) {
        if (segments.length === 1 && typeof segments[0].key === 'string') {
            // a plain top-level field like "age"
            const key = segments[0].key;
            return (data) => {
                if (hasOwn(data, key)) {
                    const value = data[key];
                    if (value !== undefined) {
                        return value;
                    }
                }
                return this.unknownVariable(variableName);
            };
        }

        return (data) => {
            const value = walk(segments, data);
            return value === MISSING ? this.unknownVariable(variableName) : value;
        };
    }

    /**
     * @param {string} variableName
     * @returns {null}
     */
    unknownVariable(variableName) {
        if (!this.throwOnUnknownVariable) {
            return null;
        }

        throw new UnknownVariableException(`Variable '${variableName}' is not defined`);
    }

    // ------------------------------------------------------------------
    // Field operators: (value, data) => boolean
    // ------------------------------------------------------------------

    /**
     * @param {string} variableName
     * @param {any} expression
     * @returns {FieldTest}
     */
    compileFieldExpression(variableName, expression) {
        expression = nz(expression);

        /** @type {string[]} */
        let operators = [];
        if (isPlainObject(expression)) {
            operators = Object.keys(expression);
            this.checkFieldExpression(expression, operators);
        }

        if (!QUERY_OPERATORS.has(operators[0])) {
            // array, null, number, string, bool, or an object that is not an
            // {$operator: operand} object: wrap it
            expression = { '$eq': expression };
            operators = ['$eq'];
        }

        /** @type {FieldTest[]} */
        const tests = new Array(operators.length);
        for (let i = 0; i < operators.length; ++i) {
            const operator = operators[i];
            if (this.track) {
                this.path.push(operator);
            }
            tests[i] = this.compileOperator(variableName, operator, nz(expression[operator]), expression);
            if (this.track) {
                this.path.pop();
            }
        }

        if (tests.length === 1) {
            return tests[0];
        }

        // Every operator runs; the results are ANDed.
        return (value, data) => {
            let result = true;
            for (let i = 0; i < tests.length; ++i) {
                result = tests[i](value, data) && result;
            }
            return result;
        };
    }

    /**
     * Checks the shape of a field condition that only the query decides:
     *
     * - $options needs $regex
     * - without an operand evaluator, an object whose first key starts with
     *   "$" must be a known operator ({age: {$gtt: 18}} would otherwise be
     *   compared as a literal object and silently never match), and an
     *   object that starts with a field may not contain operators
     *
     * With an operand evaluator, such objects may be custom functions like
     * {$var: "x"}, which the evaluator resolves.
     *
     * @param {Record<string, any>} expression a plain object
     * @param {string[]} keys its keys
     */
    checkFieldExpression(expression, keys) {
        const first = keys[0];

        if (QUERY_OPERATORS.has(first)) {
            if ((keys.length > 1 || first === '$options') && hasOwn(expression, '$options') && !hasOwn(expression, '$regex')) {
                throw new QuerySyntaxError('$options requires $regex');
            }
            return; // other keys are checked by compileOperator()
        }

        if (this.operandEvaluator !== null) {
            return;
        }

        if (first !== undefined && first[0] === '$') {
            throw new QuerySyntaxError(`Unsupported query operator: ${first}`);
        }

        for (const key of keys) {
            if (key[0] === '$') {
                throw new QuerySyntaxError(`Cannot mix fields and operators in one object: ${key}`);
            }
        }
    }

    /**
     * Checks a literal operand. Without an operand evaluator this runs while
     * compiling; with one, when the evaluator returns the operand unchanged.
     *
     * @param {string} operator
     * @param {any} operand
     * @returns {true}
     */
    validateOperand(operator, operand) {
        switch (operator) {
            case '$in':
                if (!Array.isArray(operand)) {
                    throw new QuerySyntaxError(`$in requires an array, got ${typeName(operand)}`);
                }
                break;
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte':
                if (Array.isArray(operand) || isPlainObject(operand)) {
                    // arrays and objects never match ordering
                    throw new QuerySyntaxError(`${operator} cannot compare with an array or object`);
                }
                break;
            case '$not':
                if (!isPlainObject(operand) || !QUERY_OPERATORS.has(Object.keys(operand)[0])) {
                    throw new QuerySyntaxError('$not requires an operator expression like {$not: {$gt: 5}}');
                }
                break;
        }
        return true;
    }

    /**
     * @param {string} variableName
     * @param {string} operator
     * @param {any} operand
     * @param {Record<string, any>} expression the full {$operator: operand, ...} object
     * @returns {FieldTest}
     */
    compileOperator(variableName, operator, operand, expression) {
        if (this.operandEvaluator !== null) {
            return this.compileDynamicOperator(variableName, operator, operand, expression);
        }

        this.validateOperand(operator, operand);

        // The operand is a literal, so the operator can be specialized on it.
        switch (operator) {
            case '$eq': return this.compileEq(variableName, operand);
            case '$ne': return (value) => this.evalNe(variableName, value, operand);
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte': return this.compileOrdered(operator, variableName, operand);
            case '$in': return (value) => this.evalIn(variableName, value, operand);
            case '$regex': return this.compileRegex(variableName, operand, expression);
            case '$options': return () => true;
            case '$not': return this.compileNot(variableName, operand);
            default: throw new QuerySyntaxError(`Unsupported query operator: ${operator}`);
        }
    }

    /**
     * With an operand evaluator, the operand is only known per document: the
     * evaluator runs on it every time.
     *
     * @param {string} variableName
     * @param {string} operator
     * @param {any} operand
     * @param {Record<string, any>} expression
     * @returns {FieldTest}
     */
    compileDynamicOperator(variableName, operator, operand, expression) {
        const evaluator = /** @type {(operand: any, data: object) => any} */ (this.operandEvaluator);
        const at = this.path.slice(); // for errors found at runtime

        if (operator === '$not') {
            /** @type {FieldTest|null} */
            let inner = null;
            return (value, data) => {
                const resolved = evaluator(operand, data);
                if (resolved === operand) {
                    inner ??= this.compileAt(at, () => {
                        this.validateOperand('$not', operand);
                        return this.compileFieldExpression(variableName, operand);
                    });
                    return !inner(value, EMPTY);
                }
                return !this.compileAt(at, () => this.compileFieldExpression(variableName, resolved))(value, EMPTY);
            };
        }

        const options = hasOwn(expression, '$options') ? expression['$options'] : null;

        /** @type {(value: any, resolved: any) => boolean} */
        let impl;
        switch (operator) {
            case '$eq': impl = (value, resolved) => this.evalEq(variableName, value, resolved); break;
            case '$ne': impl = (value, resolved) => this.evalNe(variableName, value, resolved); break;
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte': impl = (value, resolved) => this.evalOrdered(operator, value, resolved, variableName); break;
            case '$in': impl = (value, resolved) => this.evalIn(variableName, value, resolved); break;
            case '$regex': impl = (value, resolved) => this.matchRegex(
                this.compileAt(at, () => buildRegex(resolved, options)),
                value,
                variableName,
            ); break;
            case '$options': impl = () => true; break;
            default: throw new QuerySyntaxError(`Unsupported query operator: ${operator}`);
        }

        // A literal operand is checked like without an evaluator, once the
        // evaluator returns it unchanged.
        let checked = false;
        return (value, data) => {
            const resolved = evaluator(operand, data);
            if (!checked && resolved === operand) {
                this.compileAt(at, () => this.validateOperand(operator, operand));
                checked = true;
            }
            return impl(value, nz(resolved));
        };
    }

    /**
     * Evaluates the $eq query operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/eq/
     *
     * Syntax: { <field>: { $eq: <value> } } or shorthand: { <field>: <value> }
     *
     * @param {string} variableName
     * @param {any} operand
     * @returns {FieldTest}
     */
    compileEq(variableName, operand) {
        // An identical value is always equal, so that check runs first.
        return (value) => value === operand || this.evalEq(variableName, value, operand);
    }

    /**
     * Evaluates the $gt / $gte / $lt / $lte query operators
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/gt/
     *
     * Syntax: { <field>: { $gt: <value> } }
     *
     * Only values that can be ordered against each other are compared (see
     * isOrderable()); anything else does not match, or throws in strict
     * mode. The type check for the literal operand is done here, once, so
     * each call only checks the document value.
     *
     * @param {string} operator
     * @param {string} variableName
     * @param {any} operand
     * @returns {FieldTest}
     */
    compileOrdered(operator, variableName, operand) {
        if (this.strictMode) {
            return (value) => this.evalOrdered(operator, value, operand, variableName);
        }

        const ok = ORDER_TESTS[operator];

        if (typeof operand === 'number' && operand !== operand) {
            // NaN: only $gte / $lte match, and only NaN (NaN equals NaN)
            return operator === '$gte' || operator === '$lte'
                ? (value) => typeof value === 'number' && value !== value
                : () => false;
        }

        if (isNum(operand)) {
            // number: matches numbers and numeric strings, compared as numbers
            return (value) => isNum(value)
                ? ok(compareNumbers(value, operand))
                : typeof value === 'string' && isNumeric(value) && ok(compareNumbers(Number(value), operand));
        }

        if (typeof operand === 'string' && isNumeric(operand)) {
            // numeric string: strings compare as text, numbers as numbers
            const number = Number(operand);
            return (value) => typeof value === 'string'
                ? ok(compareStrings(value, operand))
                : isNum(value) && ok(compareNumbers(value, number));
        }

        if (typeof operand === 'string') {
            // other string: matches strings only, compared as text
            return (value) => typeof value === 'string' && ok(compareStrings(value, operand));
        }

        // null orders only against null (equal), booleans only against
        // booleans (false < true), dates only against dates
        return (value) => this.evalOrdered(operator, value, operand, variableName);
    }

    /**
     * Evaluates the $regex query operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/regex/
     *
     * Syntax: { <field>: { $regex: <pattern>, $options: <options> } }
     *
     * The pattern is built and checked once, here; see buildRegex() and
     * matchRegex().
     *
     * @param {string} variableName
     * @param {any} operand
     * @param {Record<string, any>} expression the full expression (may contain $options)
     * @returns {FieldTest}
     */
    compileRegex(variableName, operand, expression) {
        const regex = buildRegex(operand, hasOwn(expression, '$options') ? expression['$options'] : null);

        return (value) => this.matchRegex(regex, value, variableName);
    }

    /**
     * Matches a value against a pattern from buildRegex().
     *
     * Strings are matched as they are. Without strict mode, numbers are
     * matched as text ("12"); null, booleans, arrays and objects do not
     * match. In strict mode a non-string value other than null throws a
     * StrictTypeError.
     *
     * If matching fails (e.g. the regex engine runs out of stack), a
     * RegexError is thrown instead of treating it as "no match", which $not
     * would turn into a match.
     *
     * @param {RegExp} regex
     * @param {any} value
     * @param {string} variableName
     * @returns {boolean}
     */
    matchRegex(regex, value, variableName) {
        let subject;
        if (typeof value === 'string') {
            subject = value;
        } else if (value === null || value === undefined) {
            return false;
        } else if (this.strictMode) {
            throw new StrictTypeError(`$regex: variable ${variableName} is of type ${typeName(value)} while a string is expected`);
        } else if ((typeof value === 'number' && value === value) || typeof value === 'bigint') {
            subject = String(value);
        } else {
            return false;
        }

        try {
            return regex.test(subject);
        } catch (e) {
            throw new RegexError(`$regex: matching variable ${variableName} failed: ${/** @type {Error} */ (e).message}`, { cause: e });
        }
    }

    /**
     * Evaluates the $not query operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/not/
     *
     * Syntax: { <field>: { $not: { <operator-expression> } } }
     *
     * @param {string} variableName
     * @param {any} operand
     * @returns {FieldTest}
     */
    compileNot(variableName, operand) {
        const inner = this.compileFieldExpression(variableName, operand);

        // The negated expression gets empty data, as before.
        return (value) => !inner(value, EMPTY);
    }

    // ------------------------------------------------------------------
    // Field operator implementations (also used with an operand evaluator)
    // ------------------------------------------------------------------

    /**
     * @param {string} variableName
     * @param {any} variableValue
     * @param {any} operand
     * @param {string} [operator] for the exception message ($eq, or $ne
     *                            when called from evalNe() in strict mode)
     * @returns {boolean}
     */
    evalEq(variableName, variableValue, operand, operator = '$eq') {
        variableValue = nz(variableValue);
        operand = nz(operand);

        if (isNum(variableValue) && isNum(operand)) {
            return numbersEqual(variableValue, operand);
        }

        const valueKind = kind(variableValue);
        const operandKind = kind(operand);

        if (valueKind === operandKind && isScalarKind(valueKind)) {
            // boolean, string, null
            return variableValue === operand;
        }

        if (valueKind === 'array') {
            // an array matches if it equals the operand or contains it
            // (so {v: null} matches [null])
            return this.arrayEqualsOrContains(variableValue, operand);
        }

        if (variableValue === null || operand === null) {
            return false;
        }

        if (valueKind === 'date' && operandKind === 'date') {
            return datesEqual(variableValue, operand);
        }

        if (isContainerKind(valueKind) && isContainerKind(operandKind)) {
            return this.isEqualObject(variableValue, operand);
        }

        if (this.strictMode) {
            throw new StrictTypeError(`${operator}: variable ${variableName} is of type ${typeName(variableValue)} while operand is of type ${typeName(operand)}`);
        }

        return stringNumberEqual(variableValue, operand) ?? false;
    }

    /**
     * Evaluates the $ne query operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/ne/
     *
     * Syntax: { <field>: { $ne: <value> } }
     *
     * The negation of $eq: an array field does not match if it equals the
     * operand or contains it, so {role: {$ne: "banned"}} does not match
     * ["banned", "admin"]. In strict mode $ne throws exactly when $eq would
     * (two non-null values of different types, e.g. "137" vs 137).
     *
     * @param {string} variableName
     * @param {any} variableValue
     * @param {any} operand
     * @returns {boolean}
     */
    evalNe(variableName, variableValue, operand) {
        if (this.strictMode) {
            return !this.evalEq(variableName, variableValue, operand, '$ne');
        }

        variableValue = nz(variableValue);
        operand = nz(operand);

        if (isNum(variableValue) && isNum(operand)) {
            return !numbersEqual(variableValue, operand);
        }

        if (Array.isArray(variableValue)) {
            return !this.arrayEqualsOrContains(variableValue, operand);
        }

        const equal = stringNumberEqual(variableValue, operand);
        if (equal !== null) {
            return !equal;
        }

        if (kind(variableValue) !== kind(operand)) {
            return true;
        }

        return !this.isEqual(variableValue, operand);
    }

    /**
     * Evaluates the $in query operator
     *
     * MongoDB Spec: https://www.mongodb.com/docs/manual/reference/operator/query/in/
     *
     * Syntax: { <field>: { $in: [ <value1>, <value2>, ... ] } }
     *
     * Matches if the field equals one of the values, or, for an array field,
     * if the array equals one of the values or contains one of them, so
     * {role: {$in: ["admin"]}} matches ["user", "admin"].
     *
     * @param {string} variableName
     * @param {any} variableValue
     * @param {any} operand
     * @returns {boolean}
     */
    evalIn(variableName, variableValue, operand) {
        if (!Array.isArray(operand)) {
            if (this.strictMode) {
                throw new StrictTypeError(`$in: variable ${variableName}: operand must be of type array but is of type ${typeName(operand)}`);
            }
            return false;
        }

        const isList = Array.isArray(variableValue);

        for (let i = 0; i < operand.length; ++i) {
            if (isList ? this.arrayEqualsOrContains(variableValue, operand[i]) : this.isEqual(variableValue, operand[i])) {
                return true;
            }
        }
        return false;
    }

    /**
     * $eq for an array field: the array equals the operand, or one of its
     * elements does.
     *
     * @param {any[]} array
     * @param {any} operand
     * @returns {boolean}
     */
    arrayEqualsOrContains(array, operand) {
        if (Array.isArray(operand) && this.isEqual(array, operand)) {
            return true;
        }

        for (let i = 0; i < array.length; ++i) {
            if (this.isEqual(array[i], operand)) {
                return true;
            }
        }
        return false;
    }

    /**
     * $gt / $gte / $lt / $lte for values that are only known at runtime
     * (operand evaluator, $expr, strict mode).
     *
     * @param {string} operator
     * @param {any} a
     * @param {any} b
     * @param {string|null} variableName field name, or null inside $expr
     * @returns {boolean}
     */
    evalOrdered(operator, a, b, variableName) {
        a = nz(a);
        b = nz(b);

        if (!this.isOrderable(operator, a, b, variableName)) {
            return false;
        }

        let cmp;
        if (typeof a === 'string' && typeof b === 'string') {
            // two strings compare as text, like MongoDB ("10" < "9")
            cmp = compareStrings(a, b);
        } else if (a === null) {
            cmp = 0; // null vs null
        } else if (a instanceof Date) {
            cmp = compareNumbers(a.getTime(), b.getTime());
        } else if (typeof a === 'boolean') {
            cmp = compareNumbers(Number(a), Number(b));
        } else {
            // numbers, or a number and a numeric string (not in strict mode)
            cmp = compareNumbers(typeof a === 'string' ? Number(a) : a, typeof b === 'string' ? Number(b) : b);
            if (cmp !== cmp && a !== a && b !== b) {
                cmp = 0; // NaN equals NaN, so NaN >= NaN and NaN <= NaN
            }
        }

        return ORDER_TESTS[operator](cmp);
    }

    /**
     * Whether a and b can be ordered against each other:
     *
     * - number vs number (numbers and BigInts are one numeric type)
     * - string vs string
     * - boolean vs boolean (false < true)
     * - null vs null (equal)
     * - Date vs Date
     * - number vs numeric string (not in strict mode)
     *
     * Everything else (null vs number, bool vs number, arrays, objects,
     * "admin" vs 18) cannot be ordered: it does not match, or throws a
     * StrictTypeError in strict mode.
     *
     * @param {string} operator
     * @param {any} a
     * @param {any} b
     * @param {string|null} variableName field name, or null inside $expr
     * @returns {boolean}
     */
    isOrderable(operator, a, b, variableName) {
        const kindA = kind(a);
        const kindB = kind(b);

        if (kindA === 'number' && kindB === 'number') {
            return true;
        }

        if (kindA === kindB && (kindA === 'null' || kindA === 'boolean' || kindA === 'date')) {
            return true;
        }

        if (kindA === 'null' || kindB === 'null') {
            // null is "no value", not a wrong type: no match, also in strict mode
            return false;
        }

        if (this.strictMode) {
            const subject = variableName !== null ? `variable ${variableName}` : 'first operand';
            const other = variableName !== null ? 'operand' : 'second operand';

            if (kindA !== kindB) {
                throw new StrictTypeError(`${operator}: ${subject} is of type ${typeName(a)} while ${other} is of type ${typeName(b)}`);
            }
            if (kindA !== 'string') {
                throw new StrictTypeError(`${operator}: ${subject} is of type ${typeName(a)}, which cannot be ordered`);
            }
            return true;
        }

        if (kindA === 'number') {
            // number vs numeric string
            return kindB === 'string' && isNumeric(b);
        }

        if (kindA === 'string') {
            return kindB === 'string' || (kindB === 'number' && isNumeric(a));
        }

        return false;
    }

    /**
     * @param {any} a
     * @param {any} b
     * @returns {boolean}
     */
    isEqual(a, b) {
        a = nz(a);
        b = nz(b);

        if (isNum(a) && isNum(b)) {
            return numbersEqual(a, b);
        }

        const kindA = kind(a);
        const kindB = kind(b);

        if (kindA === kindB && isScalarKind(kindA)) {
            // boolean, string, null
            return a === b;
        }

        if (a === null || b === null) {
            return false;
        }

        if (kindA === 'array' && kindB === 'array' && a.length === b.length) {
            for (let i = 0; i < a.length; ++i) {
                if (!this.isEqual(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        }

        if (kindA === 'date' && kindB === 'date') {
            return datesEqual(a, b);
        }

        if (isContainerKind(kindA) && isContainerKind(kindB)) {
            return this.isEqualObject(a, b);
        }

        // "137" equals 137 only in non-strict mode; strict mode never mixes
        // strings and numbers (no match, no exception, so mixed $in lists work)
        if (this.strictMode) {
            return false;
        }

        return stringNumberEqual(a, b) ?? false;
    }

    /**
     * @param {Record<string, any>} a
     * @param {Record<string, any>} b
     * @returns {boolean}
     */
    isEqualObject(a, b) {
        const aKeys = Object.keys(a);

        if (aKeys.length !== Object.keys(b).length) {
            return false;
        }

        for (const key of aKeys) {
            if (!hasOwn(b, key)) {
                return false;
            }
            if (!this.isEqual(a[key], b[key])) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Aggregation nodes ($expr): (data) => any
    // ------------------------------------------------------------------

    /**
     * Compiles one node of an aggregation expression.
     *
     * With an operand evaluator, the evaluator runs on every node first. Only
     * if it returns the node unchanged is the compiled node used (compiled on
     * first use, so a custom function like {$var: ...} is not rejected as an
     * unknown operator). Otherwise the returned value is compiled and
     * evaluated on the spot.
     *
     * @param {any} expression
     * @returns {AggNode}
     */
    compileAgg(expression) {
        if (this.operandEvaluator === null) {
            return this.compileAggNode(expression);
        }

        const evaluator = this.operandEvaluator;
        /** @type {AggNode|null} */
        let compiled = null;
        const at = this.path.slice(); // for errors when the node is compiled later

        return (data) => {
            const resolved = evaluator(expression, data);
            if (resolved === expression) {
                compiled ??= this.compileAt(at, () => this.compileAggNode(expression));
                return compiled(data);
            }
            return this.compileAt(at, () => this.compileAggNode(resolved))(data);
        };
    }

    /**
     * Compiles the elements of a list of expressions, recording each index
     * in the error location.
     *
     * @param {any[]} list
     * @returns {AggNode[]}
     */
    compileAggItems(list) {
        const items = [];
        for (let i = 0; i < list.length; ++i) {
            if (this.track) {
                this.path.push(i);
            }
            items.push(this.compileAgg(list[i]));
            if (this.track) {
                this.path.pop();
            }
        }
        return items;
    }

    /**
     * Compiles one named part of an operator, e.g. 'if' of $cond, recording
     * it in the error location.
     *
     * @param {string} name
     * @param {any} expression
     * @returns {AggNode}
     */
    compileAggPart(name, expression) {
        if (this.track) {
            this.path.push(name);
        }
        const node = this.compileAgg(expression);
        if (this.track) {
            this.path.pop();
        }
        return node;
    }

    /**
     * @param {any} expression
     * @returns {AggNode}
     */
    compileAggNode(expression) {
        // Field references (strings starting with $)
        if (typeof expression === 'string' && expression[0] === '$') {
            const path = expression.substring(1);
            return this.compilePath(path, parseFieldPath(path));
        }

        expression = nz(expression);

        // Literal values
        if (!Array.isArray(expression) && !isPlainObject(expression)) {
            return () => expression;
        }

        // Arrays
        if (Array.isArray(expression)) {
            const items = this.compileAggItems(expression);
            return (data) => {
                const result = new Array(items.length);
                for (let i = 0; i < items.length; ++i) {
                    result[i] = items[i](data);
                }
                return result;
            };
        }

        const keys = Object.keys(expression);
        const key = keys[0];

        // An object that is not an operator is returned as-is
        if (key === undefined || key[0] !== '$') {
            for (const other of keys) {
                if (other[0] === '$') {
                    throw new QuerySyntaxError(`Cannot mix fields and operators in one object: ${other}`);
                }
            }
            return () => expression;
        }

        // An operator object has exactly one key, as in MongoDB; otherwise
        // {$gte: [...], $lt: [...]} would silently ignore $lt
        if (keys.length > 1) {
            throw new QuerySyntaxError(`An operator expression must have exactly one key, found: ${keys.join(', ')}`);
        }

        const operands = expression[key];

        if (this.track) {
            this.path.push(key);
        }

        let node;
        switch (key) {
            case '$add': node = this.compileAggAdd(operands); break;
            case '$subtract': node = this.compileAggSubtract(operands); break;
            case '$multiply': node = this.compileAggMultiply(operands); break;
            case '$divide': node = this.compileAggDivide(operands); break;
            case '$mod': node = this.compileAggMod(operands); break;
            case '$eq': node = this.compileAggEq(operands, false); break;
            case '$ne': node = this.compileAggEq(operands, true); break;
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte': node = this.compileAggOrdered(key, operands); break;
            case '$not': node = this.compileAggNot(operands); break;
            case '$in': node = this.compileAggIn(operands); break;
            case '$cond': node = this.compileAggCond(operands); break;
            case '$size': node = this.compileAggSize(operands); break;
            case '$toLower': node = this.compileAggCase(operands, '$toLower', (s) => s.toLowerCase()); break;
            case '$toUpper': node = this.compileAggCase(operands, '$toUpper', (s) => s.toUpperCase()); break;
            case '$substr': node = this.compileAggSubstr(operands, '$substr', substrCodePoints); break;
            case '$substrBytes': node = this.compileAggSubstr(operands, '$substrBytes', substrBytes); break;
            case '$strLenBytes': node = this.compileAggStrLen(operands, '$strLenBytes', (s) => Buffer.byteLength(s, 'utf8')); break;
            case '$strLenCP': node = this.compileAggStrLen(operands, '$strLenCP', strLenCodePoints); break;
            case '$trim': node = this.compileAggTrim(operands, '$trim', true, true); break;
            case '$ltrim': node = this.compileAggTrim(operands, '$ltrim', true, false); break;
            case '$rtrim': node = this.compileAggTrim(operands, '$rtrim', false, true); break;
            case '$concat': node = this.compileAggConcat(operands); break;
            case '$literal': node = compileAggLiteral(operands); break;
            default: throw new QuerySyntaxError(`Unsupported aggregation operator: ${key}`);
        }

        if (this.track) {
            this.path.pop();
        }
        return node;
    }

    /**
     * Helper to compile exactly 2 operands for binary operators
     *
     * @param {any} operands
     * @param {string} operator
     * @returns {AggNode[]}
     */
    compileBinary(operands, operator) {
        if (!Array.isArray(operands) || operands.length !== 2) {
            throw new QuerySyntaxError(`${operator} requires an array of exactly 2 operands`);
        }

        return this.compileAggItems(operands);
    }

    /**
     * @param {any} operands
     * @param {string} message
     * @returns {AggNode[]}
     */
    compileList(operands, message) {
        if (!Array.isArray(operands)) {
            throw new QuerySyntaxError(message);
        }

        return this.compileAggItems(operands);
    }

    /**
     * $add: https://www.mongodb.com/docs/manual/reference/operator/aggregation/add/
     *
     * Syntax: { $add: [ <expression1>, <expression2>, ... ] }
     *
     * BigInts are added exactly if all operands are BigInts; otherwise all
     * operands are added as numbers.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggAdd(operands) {
        const items = this.compileList(operands, '$add requires an array of operands');

        return (data) => {
            let sum = 0;
            let bigSum = 0n;
            let allBig = items.length > 0;
            for (let i = 0; i < items.length; ++i) {
                const value = items[i](data);
                if (typeof value === 'bigint') {
                    bigSum += value;
                } else if (isNumericValue(value)) {
                    sum += Number(value);
                    allBig = false;
                } else {
                    throw new QuerySyntaxError('$add operands must be numeric');
                }
            }
            return allBig ? bigSum : sum + Number(bigSum);
        };
    }

    /**
     * $subtract: https://www.mongodb.com/docs/manual/reference/operator/aggregation/subtract/
     *
     * Syntax: { $subtract: [ <expression1>, <expression2> ] }
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggSubtract(operands) {
        const [first, second] = this.compileBinary(operands, '$subtract');

        return (data) => {
            const value1 = first(data);
            const value2 = second(data);
            if (!isNumericValue(value1) || !isNumericValue(value2)) {
                throw new QuerySyntaxError('$subtract operands must be numeric');
            }
            if (typeof value1 === 'bigint' && typeof value2 === 'bigint') {
                return value1 - value2;
            }
            return Number(value1) - Number(value2);
        };
    }

    /**
     * $multiply: https://www.mongodb.com/docs/manual/reference/operator/aggregation/multiply/
     *
     * Syntax: { $multiply: [ <expression1>, <expression2>, ... ] }
     *
     * BigInts are multiplied exactly if all operands are BigInts; otherwise
     * all operands are multiplied as numbers.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggMultiply(operands) {
        const items = this.compileList(operands, '$multiply requires an array of operands');

        return (data) => {
            let product = 1;
            let bigProduct = 1n;
            let allBig = items.length > 0;
            for (let i = 0; i < items.length; ++i) {
                const value = items[i](data);
                if (typeof value === 'bigint') {
                    bigProduct *= value;
                } else if (isNumericValue(value)) {
                    product *= Number(value);
                    allBig = false;
                } else {
                    throw new QuerySyntaxError('$multiply operands must be numeric');
                }
            }
            return allBig ? bigProduct : product * Number(bigProduct);
        };
    }

    /**
     * $divide: https://www.mongodb.com/docs/manual/reference/operator/aggregation/divide/
     *
     * Syntax: { $divide: [ <expression1>, <expression2> ] }
     *
     * Always divides as numbers, also for BigInts.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggDivide(operands) {
        const [first, second] = this.compileBinary(operands, '$divide');
        assertNotLiteralZero(operands, '$divide');

        return (data) => {
            const value1 = first(data);
            const value2 = second(data);
            if (!isNumericValue(value1) || !isNumericValue(value2)) {
                throw new QuerySyntaxError('$divide operands must be numeric');
            }
            if (Number(value2) === 0) {
                throw new QuerySyntaxError('$divide: division by zero');
            }
            return Number(value1) / Number(value2);
        };
    }

    /**
     * $mod: https://www.mongodb.com/docs/manual/reference/operator/aggregation/mod/
     *
     * Syntax: { $mod: [ <expression1>, <expression2> ] }
     *
     * Both operands are truncated to integers first.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggMod(operands) {
        const [first, second] = this.compileBinary(operands, '$mod');
        assertNotLiteralZero(operands, '$mod');

        return (data) => {
            const value1 = first(data);
            const value2 = second(data);
            if (!isNumericValue(value1) || !isNumericValue(value2)) {
                throw new QuerySyntaxError('$mod operands must be numeric');
            }
            if (typeof value1 === 'bigint' && typeof value2 === 'bigint') {
                if (value2 === 0n) {
                    throw new QuerySyntaxError('$mod: division by zero');
                }
                return value1 % value2;
            }
            const divisor = Math.trunc(Number(value2));
            if (divisor === 0 || divisor !== divisor) {
                throw new QuerySyntaxError('$mod: division by zero');
            }
            return Math.trunc(Number(value1)) % divisor;
        };
    }

    /**
     * $eq: https://www.mongodb.com/docs/manual/reference/operator/aggregation/eq/
     * $ne: https://www.mongodb.com/docs/manual/reference/operator/aggregation/ne/
     *
     * Syntax: { $eq: [ <expression1>, <expression2> ] }
     *
     * @param {any} operands
     * @param {boolean} negate
     * @returns {AggNode}
     */
    compileAggEq(operands, negate) {
        const [first, second] = this.compileBinary(operands, negate ? '$ne' : '$eq');

        return (data) => this.isEqual(first(data), second(data)) !== negate;
    }

    /**
     * $gt:  https://www.mongodb.com/docs/manual/reference/operator/aggregation/gt/
     * $gte: https://www.mongodb.com/docs/manual/reference/operator/aggregation/gte/
     * $lt:  https://www.mongodb.com/docs/manual/reference/operator/aggregation/lt/
     * $lte: https://www.mongodb.com/docs/manual/reference/operator/aggregation/lte/
     *
     * Syntax: { $gt: [ <expression1>, <expression2> ] }
     *
     * Same ordering rules as the query operators, including strict mode.
     *
     * @param {string} operator
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggOrdered(operator, operands) {
        const [first, second] = this.compileBinary(operands, operator);

        return (data) => this.evalOrdered(operator, first(data), second(data), null);
    }

    /**
     * $not: https://www.mongodb.com/docs/manual/reference/operator/aggregation/not/
     *
     * Syntax: { $not: [ <expression> ] }
     *
     * false, null, 0 and 0n evaluate as false; all other values as true.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggNot(operands) {
        if (!Array.isArray(operands) || operands.length !== 1) {
            throw new QuerySyntaxError('$not requires an array with exactly one expression');
        }

        const inner = this.compileAggItems(operands)[0];

        return (data) => {
            const value = inner(data);
            return value === false || value === null || value === undefined || value === 0 || value === 0n;
        };
    }

    /**
     * $in: https://www.mongodb.com/docs/manual/reference/operator/aggregation/in/
     *
     * Syntax: { $in: [ <expression>, <array expression> ] }
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggIn(operands) {
        const [first, second] = this.compileBinary(operands, '$in');

        return (data) => {
            const searchValue = first(data);
            const arrayValue = second(data);

            if (!Array.isArray(arrayValue)) {
                throw new QuerySyntaxError('$in: second operand must be an array');
            }

            for (let i = 0; i < arrayValue.length; ++i) {
                if (this.isEqual(searchValue, arrayValue[i])) {
                    return true;
                }
            }
            return false;
        };
    }

    /**
     * $cond: https://www.mongodb.com/docs/manual/reference/operator/aggregation/cond/
     *
     * Syntax: { $cond: { if: <boolean-expression>, then: <true-case>, else: <false-case> } }
     *
     * Only the chosen branch is evaluated.
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggCond(operands) {
        if (!isPlainObject(operands)) {
            throw new QuerySyntaxError('$cond requires an object with if, then, else properties');
        }

        if (!hasOwn(operands, 'if') || !hasOwn(operands, 'then') || !hasOwn(operands, 'else')) {
            throw new QuerySyntaxError('$cond requires if, then, and else properties');
        }

        const condition = this.compileAggPart('if', operands['if']);
        const then = this.compileAggPart('then', operands['then']);
        const otherwise = this.compileAggPart('else', operands['else']);

        return (data) => toBool(condition(data)) ? then(data) : otherwise(data);
    }

    /**
     * $size: https://www.mongodb.com/docs/manual/reference/operator/aggregation/size/
     *
     * Syntax: { $size: <expression> }
     *
     * @param {any} operand
     * @returns {AggNode}
     */
    compileAggSize(operand) {
        const inner = this.compileAgg(operand);

        return (data) => {
            const value = inner(data);
            if (!Array.isArray(value)) {
                throw new QuerySyntaxError('$size: argument must resolve to an array');
            }
            return value.length;
        };
    }

    /**
     * $toLower: https://www.mongodb.com/docs/manual/reference/operator/aggregation/toLower/
     * $toUpper: https://www.mongodb.com/docs/manual/reference/operator/aggregation/toUpper/
     *
     * Syntax: { $toLower: <expression> }
     *
     * @param {any} operand
     * @param {string} operator
     * @param {(value: string) => string} convert
     * @returns {AggNode}
     */
    compileAggCase(operand, operator, convert) {
        const inner = this.compileAgg(operand);

        return (data) => {
            const value = inner(data);
            if (typeof value !== 'string') {
                throw new QuerySyntaxError(`${operator}: argument must resolve to a string`);
            }
            return convert(value);
        };
    }

    /**
     * $substr:      https://www.mongodb.com/docs/manual/reference/operator/aggregation/substr/ (codepoints)
     * $substrBytes: https://www.mongodb.com/docs/manual/reference/operator/aggregation/substrBytes/ (bytes)
     *
     * Syntax: { $substr: [ <string>, <start>, <length> ] }
     *
     * @param {any} operands
     * @param {string} operator
     * @param {(value: string, start: number, length: number|null) => string} substring
     * @returns {AggNode}
     */
    compileAggSubstr(operands, operator, substring) {
        if (!Array.isArray(operands) || operands.length !== 3) {
            throw new QuerySyntaxError(`${operator} requires an array of [string, start, length]`);
        }

        const [stringNode, startNode, lengthNode] = this.compileAggItems(operands);

        return (data) => {
            const string = stringNode(data);
            const start = startNode(data);
            const length = lengthNode(data);

            if (typeof string !== 'string') {
                throw new QuerySyntaxError(`${operator}: first argument must resolve to a string`);
            }
            if (!isInteger(start)) {
                throw new QuerySyntaxError(`${operator}: second argument must resolve to an integer`);
            }
            if (!isInteger(length)) {
                throw new QuerySyntaxError(`${operator}: third argument must resolve to an integer`);
            }

            return substring(string, Number(start), length < 0 ? null : Number(length));
        };
    }

    /**
     * $strLenBytes: https://www.mongodb.com/docs/manual/reference/operator/aggregation/strLenBytes/
     * $strLenCP:    https://www.mongodb.com/docs/manual/reference/operator/aggregation/strLenCP/
     *
     * Syntax: { $strLenBytes: <expression> }
     *
     * @param {any} operand
     * @param {string} operator
     * @param {(value: string) => number} length
     * @returns {AggNode}
     */
    compileAggStrLen(operand, operator, length) {
        const inner = this.compileAgg(operand);

        return (data) => {
            const value = inner(data);
            if (typeof value !== 'string') {
                throw new QuerySyntaxError(`${operator}: argument must resolve to a string`);
            }
            return length(value);
        };
    }

    /**
     * $trim:  https://www.mongodb.com/docs/manual/reference/operator/aggregation/trim/
     * $ltrim: https://www.mongodb.com/docs/manual/reference/operator/aggregation/ltrim/
     * $rtrim: https://www.mongodb.com/docs/manual/reference/operator/aggregation/rtrim/
     *
     * Syntax: { $trim: { input: <string>, chars: <string> } }
     *
     * Without chars, trims " ", "\t", "\n", "\r", "\0" and "\x0B". Each
     * character of chars is trimmed (no ranges).
     *
     * @param {any} operand
     * @param {string} operator
     * @param {boolean} left
     * @param {boolean} right
     * @returns {AggNode}
     */
    compileAggTrim(operand, operator, left, right) {
        if (!isPlainObject(operand)) {
            throw new QuerySyntaxError(`${operator} requires an object with 'input' property`);
        }

        if (!hasOwn(operand, 'input')) {
            throw new QuerySyntaxError(`${operator} requires 'input' property`);
        }

        const inputNode = this.compileAggPart('input', operand['input']);
        const charsNode = hasOwn(operand, 'chars') ? this.compileAggPart('chars', operand['chars']) : null;

        return (data) => {
            const input = inputNode(data);
            if (typeof input !== 'string') {
                throw new QuerySyntaxError(`${operator}: 'input' must resolve to a string`);
            }

            if (charsNode === null) {
                return trim(input, DEFAULT_TRIM_CHARS, left, right);
            }

            const chars = charsNode(data);
            if (typeof chars !== 'string') {
                throw new QuerySyntaxError(`${operator}: 'chars' must resolve to a string`);
            }
            return trim(input, new Set(chars), left, right);
        };
    }

    /**
     * $concat: https://www.mongodb.com/docs/manual/reference/operator/aggregation/concat/
     *
     * Syntax: { $concat: [ <expression1>, <expression2>, ... ] }
     *
     * @param {any} operands
     * @returns {AggNode}
     */
    compileAggConcat(operands) {
        const items = this.compileList(operands, '$concat requires an array of string expressions');

        return (data) => {
            let result = '';
            for (let i = 0; i < items.length; ++i) {
                const value = items[i](data);
                if (typeof value !== 'string') {
                    throw new QuerySyntaxError('$concat: all arguments must resolve to strings');
                }
                result += value;
            }
            return result;
        };
    }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * $literal: https://www.mongodb.com/docs/manual/reference/operator/aggregation/literal/
 *
 * Syntax: { $literal: <value> }
 *
 * Returns the value without parsing it: "$price" stays the string "$price"
 * instead of a field reference, and {$add: [2, 3]} stays that object.
 * Nothing inside is compiled, evaluated or passed to the operand evaluator.
 *
 * @param {any} value
 * @returns {AggNode}
 */
function compileAggLiteral(value) {
    value = nz(value);
    return () => value;
}

/**
 * Short-circuiting AND over query nodes.
 *
 * @param {QueryNode[]} children
 * @returns {QueryNode}
 */
function all(children) {
    if (children.length === 1) {
        return children[0];
    }

    return (data) => {
        for (let i = 0; i < children.length; ++i) {
            if (!children[i](data)) {
                return false;
            }
        }
        return true;
    };
}

/**
 * @param {Array<string|number>} path
 * @returns {string}
 */
function formatPath(path) {
    let out = '';
    for (const segment of path) {
        out += typeof segment === 'number' ? `[${segment}]` : (out === '' ? segment : `.${segment}`);
    }
    return out;
}

/**
 * Splits a field path like "items[0].name" into segments, once.
 *
 * Each segment is [isIndex, key]: [true, 0] for "[0]" and [false, "name"]
 * for "name". An escaped dot ("a\.b") stays part of the key, as before.
 *
 * @param {string} variableName
 * @returns {Array<[boolean, string|number]>}
 */
function parsePath(variableName) {
    if (variableName !== '' && !/[.[\\]/.test(variableName)) {
        // a plain field name like "age"
        return [[false, variableName]];
    }

    if (!/[[\\]/.test(variableName)) {
        // No index and no escaped dot: the regex below reduces to the
        // non-empty runs between dots.
        /** @type {Array<[boolean, string|number]>} */
        const segments = [];
        for (const part of variableName.split('.')) {
            if (part !== '') {
                segments.push([false, part]);
            }
        }
        return segments;
    }

    const parts = variableName.replace(/\[/g, '.[').match(/(\\\.|[^.]+?)+/g) || [];

    return parts.map((part) => {
        const index = /\[(\d+)\]$/.exec(part);
        return index ? [true, parseInt(index[1], 10)] : [false, part];
    });
}

/**
 * parsePath() for paths in a query, as Segments: also rejects paths with an
 * empty segment: "", ".", "a..b", ".a", "a." (an escaped dot as in "a\." is
 * part of the key). Without this, "." would resolve to the whole document
 * and "a..b" would silently mean "a.b".
 *
 * @param {string} path
 * @returns {Segment[]}
 */
function parseFieldPath(path) {
    if (isPlainName(path)) {
        return [{ key: path, idx: arrayIndex(path) }];
    }

    if (path === '' || /[.\\]/.test(path)) {
        let segmentLength = 0;
        for (let i = 0; i < path.length; i++) {
            const char = path[i];
            if (char === '\\') {
                segmentLength += 2;
                i++;
            } else if (char === '.') {
                if (segmentLength === 0) {
                    throw new QuerySyntaxError(`Invalid field path "${path}": empty segment`);
                }
                segmentLength = 0;
            } else if (char === '[') {
                segmentLength = 1; // "[0]" starts a new, non-empty segment
            } else {
                segmentLength++;
            }
        }

        if (segmentLength === 0) {
            throw new QuerySyntaxError(`Invalid field path "${path}": empty segment`);
        }
    }

    return toSegments(parsePath(path));
}

/**
 * @param {Array<[boolean, string|number]>} parsed
 * @returns {Segment[]}
 */
function toSegments(parsed) {
    return parsed.map(([isIndex, key]) => ({
        key,
        idx: isIndex ? /** @type {number} */ (key) : arrayIndex(/** @type {string} */ (key)),
    }));
}

/**
 * A non-empty field name without ".", "[" and "\".
 *
 * @param {string} path
 * @returns {boolean}
 */
function isPlainName(path) {
    if (path === '') {
        return false;
    }
    for (let i = 0; i < path.length; ++i) {
        const char = path.charCodeAt(i);
        if (char === 0x2E || char === 0x5B || char === 0x5C) {
            return false;
        }
    }
    return true;
}

/**
 * The array index a named segment selects ("0", "12"), or -1 if it cannot
 * select one.
 *
 * @param {string} key
 * @returns {number}
 */
function arrayIndex(key) {
    const first = key.charCodeAt(0);
    return first >= 0x30 && first <= 0x39 && ARRAY_INDEX.test(key) ? Number(key) : -1;
}

/**
 * Resolves segments against data, using own properties only (so
 * "constructor" or "__proto__" never resolve to inherited values). Returns
 * MISSING for a path that does not exist and stops at null.
 *
 * @param {Segment[]} segments
 * @param {any} data
 * @returns {any}
 */
function walk(segments, data) {
    let value = data;
    for (let i = 0; i < segments.length; ++i) {
        if (value === null || typeof value !== 'object') {
            return MISSING;
        }

        const segment = segments[i];
        if (Array.isArray(value)) {
            if (segment.idx < 0 || segment.idx >= value.length) {
                return MISSING;
            }
            value = value[segment.idx];
        } else {
            if (!hasOwn(value, segment.key)) {
                return MISSING;
            }
            value = value[segment.key];
        }

        if (value === undefined) {
            return MISSING;
        }
        if (value === null) {
            return null;
        }
    }
    return value;
}

/**
 * Builds a RegExp from a $regex pattern and $options. Throws a SyntaxError
 * for:
 *
 * - a pattern that is not a string
 * - $options that is not a string or contains other letters than
 *   i, m, s, x, u (the options MongoDB supports)
 * - a pattern that ends with an unescaped backslash
 * - a pattern that cannot be compiled
 *
 * "x" (extended) is not supported by JavaScript; whitespace and #-comments
 * outside character classes are removed from the pattern instead.
 *
 * @param {any} pattern
 * @param {any} options
 * @returns {RegExp}
 */
function buildRegex(pattern, options) {
    if (typeof pattern !== 'string') {
        throw new QuerySyntaxError(`$regex requires a string pattern, got ${typeName(pattern)}`);
    }

    options = nz(options) ?? '';
    if (typeof options !== 'string') {
        throw new QuerySyntaxError(`$options requires a string, got ${typeName(options)}`);
    }

    let flags = '';
    let extended = false;
    for (const option of options) {
        if (!'imsxu'.includes(option)) {
            throw new QuerySyntaxError(`Unsupported $regex option: ${option} (supported: i, m, s, x, u)`);
        }
        if (option === 'x') {
            extended = true;
        } else if (!flags.includes(option)) {
            flags += option;
        }
    }

    let trailingBackslashes = 0;
    while (trailingBackslashes < pattern.length && pattern[pattern.length - 1 - trailingBackslashes] === '\\') {
        trailingBackslashes++;
    }
    if (trailingBackslashes % 2 === 1) {
        throw new QuerySyntaxError('$regex pattern ends with an unescaped backslash');
    }

    try {
        return new RegExp(extended ? stripExtended(pattern) : pattern, flags);
    } catch (e) {
        throw new QuerySyntaxError(`Invalid $regex pattern "${pattern}": ${/** @type {Error} */ (e).message}`);
    }
}

/**
 * Removes whitespace and #-comments outside character classes, like PCRE's
 * extended mode ("x").
 *
 * @param {string} pattern
 * @returns {string}
 */
function stripExtended(pattern) {
    let out = '';
    let inClass = false;
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '\\') {
            out += char + pattern[++i];
        } else if (inClass) {
            if (char === ']') {
                inClass = false;
            }
            out += char;
        } else if (char === '[') {
            inClass = true;
            out += char;
            if (pattern[i + 1] === '^') {
                out += pattern[++i];
            }
            if (pattern[i + 1] === ']') {
                out += '\\' + pattern[++i]; // a "]" right after "[" is literal in PCRE
            }
        } else if (char === '#') {
            while (i + 1 < pattern.length && pattern[i + 1] !== '\n') {
                i++;
            }
        } else if (!' \t\n\r\v\f'.includes(char)) {
            out += char;
        }
    }
    return out;
}

/**
 * A literal divisor of 0 is a syntax error, found while compiling instead of
 * with the first document that reaches it.
 *
 * @param {any} operands
 * @param {string} operator
 */
function assertNotLiteralZero(operands, operator) {
    if (Array.isArray(operands) && isNum(operands[1]) && Number(operands[1]) === 0) {
        throw new QuerySyntaxError(`${operator}: division by zero`);
    }
}

/**
 * @param {string} string
 * @param {number} start
 * @param {number|null} length
 * @returns {string}
 */
function substrCodePoints(string, start, length) {
    const chars = Array.from(string);
    if (start < 0) {
        start = Math.max(chars.length + start, 0);
    }
    return (length === null ? chars.slice(start) : chars.slice(start, start + length)).join('');
}

/**
 * @param {string} string
 * @param {number} start
 * @param {number|null} length
 * @returns {string}
 */
function substrBytes(string, start, length) {
    const buffer = Buffer.from(string, 'utf8');
    if (start < 0) {
        start = Math.max(buffer.length + start, 0);
    }
    return (length === null ? buffer.subarray(start) : buffer.subarray(start, start + length)).toString('utf8');
}

/**
 * @param {string} string
 * @returns {number}
 */
function strLenCodePoints(string) {
    let length = 0;
    for (const _ of string) {
        length++;
    }
    return length;
}

/**
 * @param {string} input
 * @param {Set<string>} chars
 * @param {boolean} left
 * @param {boolean} right
 * @returns {string}
 */
function trim(input, chars, left, right) {
    const codePoints = Array.from(input);
    let start = 0;
    let end = codePoints.length;
    if (left) {
        while (start < end && chars.has(codePoints[start])) {
            start++;
        }
    }
    if (right) {
        while (end > start && chars.has(codePoints[end - 1])) {
            end--;
        }
    }
    return codePoints.slice(start, end).join('');
}

/**
 * undefined is "no value", like null.
 *
 * @param {any} value
 * @returns {any}
 */
function nz(value) {
    return value === undefined ? null : value;
}

/**
 * @param {any} value
 * @returns {value is number|bigint}
 */
function isNum(value) {
    const type = typeof value;
    return type === 'number' || type === 'bigint';
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isInteger(value) {
    return Number.isInteger(value) || typeof value === 'bigint';
}

/**
 * Like PHP's is_numeric() for strings: decimal numbers with optional sign,
 * fraction and exponent, and optional surrounding whitespace ("1e2", " 12").
 * No hex, no "Infinity".
 *
 * @param {string} value
 * @returns {boolean}
 */
function isNumeric(value) {
    return NUMERIC_STRING.test(value);
}

/**
 * A number, BigInt or numeric string, for the arithmetic operators.
 *
 * @param {any} value
 * @returns {boolean}
 */
function isNumericValue(value) {
    return isNum(value) || (typeof value === 'string' && isNumeric(value));
}

/**
 * Plain objects ({...}, Object.create(null)) are operator expressions or
 * objects compared key by key; arrays, Dates and class instances are not.
 *
 * @param {any} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * The comparison type of a value: numbers and BigInts are one type.
 *
 * @param {any} value
 * @returns {string}
 */
function kind(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    const type = typeof value;
    if (type === 'bigint') {
        return 'number';
    }
    if (type !== 'object') {
        return type;
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return value instanceof Date ? 'date' : 'object';
}

/**
 * @param {string} valueKind
 * @returns {boolean}
 */
function isScalarKind(valueKind) {
    return valueKind === 'string' || valueKind === 'boolean' || valueKind === 'null';
}

/**
 * @param {string} valueKind
 * @returns {boolean}
 */
function isContainerKind(valueKind) {
    return valueKind === 'object' || valueKind === 'array';
}

/**
 * Type name for error messages.
 *
 * @param {any} value
 * @returns {string}
 */
function typeName(value) {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    if (value instanceof Date) {
        return 'date';
    }
    return typeof value;
}

/**
 * Numbers and BigInts compare by value (JavaScript compares them exactly).
 * NaN equals NaN, as in MongoDB.
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 * @returns {boolean}
 */
function numbersEqual(a, b) {
    // eslint-disable-next-line eqeqeq
    return a == b || (a !== a && b !== b);
}

/**
 * -1, 0 or 1, or NaN if a or b is NaN.
 *
 * @param {number|bigint} a
 * @param {number|bigint} b
 * @returns {number}
 */
function compareNumbers(a, b) {
    // eslint-disable-next-line eqeqeq
    return a < b ? -1 : (a > b ? 1 : (a == b ? 0 : NaN));
}

/**
 * Compares two strings by code point, which is the byte order of UTF-8 and
 * what MongoDB does. JavaScript's own < compares UTF-16 code units, which
 * sorts characters above U+FFFF before U+E000-U+FFFF.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareStrings(a, b) {
    if (a === b) {
        return 0;
    }

    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; ++i) {
        let x = a.charCodeAt(i);
        let y = b.charCodeAt(i);
        if (x !== y) {
            if (x >= 0xD800 && y >= 0xD800) {
                // move surrogates (U+D800-U+DFFF) above U+E000-U+FFFF
                x = x >= 0xE000 ? x - 0x800 : x + 0x2000;
                y = y >= 0xE000 ? y - 0x800 : y + 0x2000;
            }
            return x - y;
        }
    }
    return a.length - b.length;
}

/**
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
function datesEqual(a, b) {
    const x = a.getTime();
    const y = b.getTime();
    return x === y || (x !== x && y !== y);
}

/**
 * Non-strict equality between a string and a number: "137" equals 137,
 * compared as text. Null if a and b are not a string/number pair.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean|null}
 */
function stringNumberEqual(a, b) {
    if (typeof a === 'string' && isNum(b)) {
        return b === b && a === String(b);
    }
    if (typeof b === 'string' && isNum(a)) {
        return a === a && String(a) === b;
    }
    return null;
}

/**
 * Boolean cast for $expr and $cond: false, null, 0, 0n, "", "0", [] and {}
 * are false, everything else is true.
 *
 * @param {any} value
 * @returns {boolean}
 */
function toBool(value) {
    if (value === null || value === undefined || value === false) {
        return false;
    }
    switch (typeof value) {
        case 'boolean': return true;
        case 'number': return value !== 0;
        case 'bigint': return value !== 0n;
        case 'string': return value !== '' && value !== '0';
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (isPlainObject(value)) {
        return Object.keys(value).length > 0;
    }
    return true;
}

/**
 * JSON for error messages, also for values JSON cannot encode.
 *
 * @param {any} value
 * @returns {string}
 */
function stringify(value) {
    try {
        return String(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
    } catch {
        return String(value);
    }
}

module.exports = {
    Compiler,
    parsePath,
    toSegments,
    walk,
    MISSING,
};
