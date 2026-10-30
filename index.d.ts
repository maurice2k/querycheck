declare namespace QueryCheck {
    /** A MongoDB-style query, e.g. `{age: {$gte: 18}, $or: [...]}`. */
    type Query = Record<string, unknown>;

    /**
     * Resolves custom operands like `{$var: "x"}`. Called with the QueryCheck
     * instance as `this`. Return the operand unchanged if it is not yours.
     */
    type OperandEvaluator = (this: QueryCheck, operand: unknown, data: object) => unknown;

    /** Base type of all QueryCheck errors (`err instanceof QueryCheckError`). */
    class QueryCheckError extends Error {}

    /**
     * Invalid query. Errors found while compiling start with their location
     * (`$or[1].age.$gtt: Unsupported query operator: $gtt`); `cause` is the
     * error without the location.
     */
    class QuerySyntaxError extends globalThis.SyntaxError {}

    /** Same as QuerySyntaxError. */
    const SyntaxError: typeof QuerySyntaxError;
    type SyntaxError = QuerySyntaxError;

    /** Strict mode: two non-null values of different types were compared. */
    class StrictTypeError extends TypeError {}

    /** A $regex failed while matching a value. */
    class RegexError extends Error {}

    /** A field path does not exist in the document. */
    class UnknownVariableException extends Error {}
}

declare class QueryCheck {
    constructor(query: QueryCheck.Query);

    /**
     * When enabled (the default), a missing field throws
     * UnknownVariableException. When disabled, it compares as null.
     */
    setThrowOnUnknownVariable(throwOnUnknown: boolean): void;

    /** Two non-null values of different types throw StrictTypeError. */
    setStrictMode(strictMode: boolean): void;

    setOperandEvaluator(fn: QueryCheck.OperandEvaluator | null): void;

    /** Whether the document matches the query. */
    test(data: unknown): boolean;

    /** Compiles the query now and throws QuerySyntaxError if it is invalid. */
    validate(): void;

    /** Resolves a path like `customer.address.city` or `items[0].name`. */
    getVariableValue(variableName: string, data: object): unknown;
}

export = QueryCheck;
