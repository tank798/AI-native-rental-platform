export function clarificationPrompt({ fieldKey, reasonCode, expectedAnswerType, options = [], templateQuestion, publicContext = {} }) {
  const requiredOutput = {
    question: templateQuestion,
    fieldKey,
    reasonCode,
    expectedAnswerType,
    options
  };
  return {
    system: `你是租房匹配澄清问题编辑。输出必须是一个扁平 JSON 对象，只能改写 question 的中文措辞。fieldKey、reasonCode、expectedAnswerType 和 options 必须从 requiredOutput 逐字复制，大小写、标点和数组顺序都不能改变。不要添加外层对象或新字段。不得提及对方底价、预算上限、原始输入、联系方式或隐藏推理。`,
    user: JSON.stringify({
      task: "rewrite_one_clarification_question",
      publicContext,
      requiredOutput,
      instruction: "只改写 requiredOutput.question；其余四个字段原样复制。只返回改写后的 requiredOutput JSON。"
    })
  };
}
