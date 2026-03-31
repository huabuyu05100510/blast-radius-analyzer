// Test Case 9: Consumer of simple functions
import { add, processData, classify, sumArray, safeParse, processUserInput, divide } from './simple';

export const calculate = () => {
  const result = add(1, 2);
  return result;
};

export const handleData = () => {
  const len = processData("hello");
  return len;
};

export const grade = () => {
  return classify(95);
};

export const total = () => {
  return sumArray([1, 2, 3, 4, 5]);
};

export const parse = () => {
  return safeParse('{"key": "value"}');
};

export const sanitize = () => {
  return processUserInput('<script>alert(1)</script>');
};

export const division = () => {
  return divide(10, 2);
};
