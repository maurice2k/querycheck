'use strict';

/**
 * Query check
 *
 * @author Moritz Fain <moritz@fain.io>
 */
class QueryCheck {

    constructor(query) {
        this.query = query;

        this.booleanOperators = {
            '$or': this._evalOr,
            '$and': this._evalAnd,
        }

        this.expressionOperators = {
            '$eq': this._evalEq,
            '$ne': this._evalNe,
            '$gt': this._evalGt,
            '$gte': this._evalGte,
            '$lt': this._evalLt,
            '$lte': this._evalLte,
            '$in': this._evalIn,
            '$regex': this._evalRegExp,
            '$options': this._evalTrue,
            '$not': this._evalNot
        }

        this.undefinedEqualsNull = false;
        this.strictMode = false;
        this.operandEvaluator = null;
    }

    setUndefinedEqualsNull(equalsNull) {
        this.undefinedEqualsNull = equalsNull;
    }

    setStrictMode(strictMode) {
        this.strictMode = strictMode;
    }

    setOperandEvaluator(fn) {
        this.operandEvaluator = fn;
    }

    test(data) {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            if (this.strictMode) {
                throw new TypeError('Input data must be a hash/object');
            }
            return false;
        }

        return this._evalQuery(this.query, data);
    }

    _evalQuery(query, data) {
        if (!typeof(query) == 'object') {
            throw new SyntaxError(`Query must be an object: ${query}`);
        }

        const keys = Object.keys(query);
        if (keys.length > 1) {
            // implicit $and structure; re-format
            let andQuery = [];
            for (let k = 0; k < keys.length; ++k) {
                let partial = {};
                partial[keys[k]] = query[keys[k]];
                andQuery.push(partial);
            }

            return this._evalAnd(andQuery, data);
        }

        if (keys.length == 0) {
            // empty query is always valid
            return true;
        }

        // we have exactly one key
        const key = keys[0];
        let value = query[key];

        if (key == '') {
            throw new SyntaxError(`Empty keys are not supported!`);
        }

        if (key[0] == '$') {
            // "key" must be a boolean operator like $and/$or, "value" the
            // sub queries to parse and evaluate
            const booleanParser = this.booleanOperators[key] || null;

            if (typeof(booleanParser) !== "function") {
                throw new Error(`Unsupported boolean operator: ${key}`);
            }

            return booleanParser.apply(this, [value, data]);

        } else {
            // "key" is a variable name; "value" the expression (or a set of
            // expressions) to parse and evaluate.

            // the default style of an expression is as follows:
            // {age: {$eq: 37}}

            // additionally, the following shortcut styles are also supported:
            // {age: 37}      == {age: {$eq: 37}}
            // {age: null}    == {age: {$eq: null}}
            // {age: {$gt: 30, $lt: 40}}
            //                == {$and: [{age: {$gt: 30}}, {age: {$lt: 40}}]}


            const variableValue = this.getVariableValue(key, data);
            return this._evalExpression(key, variableValue, value, data);
        }
    }

    _evalExpression(variableName, variableValue, expression, data) {

        if (Array.isArray(expression) || expression === null || typeof(expression) !== 'object') {
            // expression is of type array, null, number, string, bool; wrap it
            expression = {'$eq': expression};
        } else if (typeof(expression) === 'object') {
            // expression is an object, let's check if it's some kind of supported {$operator: operand} object
            // and wrap it otherwise
            const keys = Object.keys(expression)
            if (keys.length == 0 || !(keys[0] in this.expressionOperators)) {
                expression = {'$eq': expression};
            }
        } else {
            throw new Error(`Unsupported expression: ` + JSON.stringify(expression));
        }

        let result = true;
        const operators = Object.keys(expression);
        for (let i = 0; i < operators.length; ++i) {
            const operator = operators[i];
            let operand = expression[operator];
            if (this.operandEvaluator !== null) {
                operand = this.operandEvaluator.apply(this, [operand, data]);
            }

            const expressionParser = this.expressionOperators[operator] || null;

            if (typeof(expressionParser) !== "function") {
                throw new Error(`Unsupported expression operator: ${operator}`);
            }

            result = expressionParser.apply(this, [variableName, variableValue, operand, expression]) && result;
        }
        return result;

    }

    getVariableValue(variableName, data) {
        let str = variableName.replace(/\[/g, '.[');
        let parts = str.match(/(\\\.|[^.]+?)+/g);
        const re = /\[(\d+)\]$/;

        for (let i = 0; i < parts.length; ++i) {
            const matches = re.exec(parts[i]);
            if (matches) {
                let idx = parseFloat(matches[1]);
                data = data[idx];
            } else {
                data = data[parts[i]];
            }

            if (data === undefined || data === null) {
                break;
            }
        }

        if (data === undefined && this.undefinedEqualsNull) {
            return null;
        }

        return data;
    }

    _evalOr(query, data) {
        if (!Array.isArray(query)) {
            throw new Error('$or can only operate on arrays of queries');
        }

        let result = false;
        for (let i = 0; i < query.length; ++i) {
            result = this._evalQuery(query[i], data) || result;
        }

        return result;
    }

    _evalAnd(query, data) {
        if (!Array.isArray(query)) {
            throw new Error('$and can only operate on arrays of queries');
        }

        let result = true;
        for (let i = 0; i < query.length; ++i) {
            // keep this sorting ('&& result' at the end)
            result = this._evalQuery(query[i], data) && result;
        }

        return result;
    }

    _evalEq(variableName, variableValue, operand) {
        if (typeof(variableValue) == typeof(operand) && typeof(variableValue) != 'object') {
            // boolean, number, string
            return variableValue === operand;
        }

        if (variableValue === null || operand === null) {
            // either variableValue or operand are null or both are null
            return variableValue === operand;
        }

        if (Array.isArray(variableValue)) {

            if (Array.isArray(operand)) {
                if (this._isEqual(variableValue, operand)) {
                    return true;
                }
            }

            return this._evalIn(variableName, operand, variableValue);
        }

        if (typeof(variableValue) === 'object' && typeof(operand) === 'object') {
            return this._isEqualObject(variableValue, operand);
        }

        if (this.strictMode) {
            throw new TypeError(`$eq: variable ${variableName} is of type ${typeof(variableValue)} while operand is of type ${typeof(operand)}`);
        }

        if (typeof(variableValue) === 'string' && typeof(operand) === 'number') {
            return variableValue === String(operand);
        } else if (typeof(variableValue) === 'number' && typeof(operand) === 'string') {
            return String(variableValue) === operand;
        }

        return false;
    }

    _evalNe(variableName, variableValue, operand) {
        if (!this.strictMode) {
            if (typeof(variableValue) === 'string' && typeof(operand) === 'number') {
                return variableValue !== String(operand);
            } else if (typeof(variableValue) === 'number' && typeof(operand) === 'string') {
                return String(variableValue) !== operand;
            }
        }

        if (typeof(variableValue) != typeof(operand)) {
            return true;
        }

        return !this._isEqual(variableValue, operand);
    }

    _evalGt(variableName, variableValue, operand) {
        if (this.strictMode && typeof(variableValue) != typeof(operand) && variableValue !== null) {
            throw new TypeError(`$gt: variable ${variableName} is of type ${typeof(variableValue)} while operand is of type ${typeof(operand)}`);
        }

        return variableValue > operand;
    }

    _evalGte(variableName, variableValue, operand) {
        if (this.strictMode && typeof(variableValue) != typeof(operand) && variableValue !== null) {
            throw new TypeError(`$gte: variable ${variableName} is of type ${typeof(variableValue)} while operand is of type ${typeof(operand)}`);
        }
        return variableValue >= operand;
    }

    _evalLt(variableName, variableValue, operand) {
        if (this.strictMode && typeof(variableValue) != typeof(operand) && variableValue !== null) {
            throw new TypeError(`$lt: variable ${variableName} is of type ${typeof(variableValue)} while operand is of type ${typeof(operand)}`);
        }
        return variableValue < operand;
    }

    _evalLte(variableName, variableValue, operand) {
        if (this.strictMode && typeof(variableValue) != typeof(operand) && variableValue !== null) {
            throw new TypeError(`$lte: variable ${variableName} is of type ${typeof(variableValue)} while operand is of type ${typeof(operand)}`);
        }
        return variableValue <= operand;
    }

    _evalIn(variableName, variableValue, operand) {
        if (!Array.isArray(operand)) {
            if (this.strictMode) {
                throw new TypeError(`$in: variable ${variableName}: operand must be of type array but is of type ${typeof(operand)}`);
            };
            return false;
        }

        for (let i = 0; i < operand.length; ++i) {
            if (this._isEqual(variableValue, operand[i])) {
                return true;
            }
        }
        return false;
    }

    _evalRegExp(variableName, variableValue, operand, expression) {
        const options = expression['$options'] || undefined;
        const re = new RegExp(operand, options);
        return re.test(variableValue);
    }

    _evalTrue() {
        return true;
    }

    _evalNot(variableName, variableValue, operand) {
        return !this._evalExpression(variableName, variableValue, operand);
    }

    _isEqual(a, b) {
        if (typeof(a) == typeof(b) && typeof(a) != 'object') {
            // boolean, number, string
            return a === b;
        }

        if (a === null || b === null) {
            // either a or b are null or both are null
            return a === b;
        }

        if (Array.isArray(a) && Array.isArray(b) && a.length == b.length) {

            for (let i = 0; i < a.length; ++i) {
                if (!this._isEqual(a[i], b[i])) {
                    return false;
                }
            }

            return true;
        }

        if (typeof(a) === 'object' && typeof(b) === 'object') {
            return this._isEqualObject(a, b);
        }

        if (typeof(a) === 'string' && typeof(b) === 'number') {
            return a === String(b);
        } else if (typeof(a) === 'number' && typeof(b) === 'string') {
            return String(a) === b;
        }

        return false;
    }

    _isEqualObject(a, b) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length != bKeys.length) {
            return false;
        }

        for (let aKey of aKeys) {
            if (b[aKey] === undefined) {
                return false;
            }
            if (!this._isEqual(a[aKey], b[aKey])) {
                return false;
            }
        }
        return true;
    }
}

module.exports = QueryCheck;
