import QueryCheck = require('..');

const qc = new QueryCheck({ age: { $gte: 18 } });
qc.setStrictMode(true);
qc.setThrowOnUnknownVariable(false);
qc.setOperandEvaluator(function (operand, data) {
    if (operand !== null && typeof operand === 'object' && '$var' in operand) {
        return this.getVariableValue(String((operand as { $var: unknown }).$var), data);
    }
    return operand;
});
qc.validate();
const matches: boolean = qc.test({ age: 30 });

try {
    qc.test({});
} catch (e) {
    if (e instanceof QueryCheck.SyntaxError || e instanceof QueryCheck.QuerySyntaxError) {
        const message: string = e.message;
    } else if (e instanceof QueryCheck.StrictTypeError || e instanceof QueryCheck.RegexError) {
    } else if (e instanceof QueryCheck.UnknownVariableException || e instanceof QueryCheck.QueryCheckError) {
    }
}
