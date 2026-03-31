// Test Case 1: Simple function (no branches)
export const add = (a: number, b: number): number => {
  return a + b;
};

// Test Case 2: Function with type narrowing
export const processData = (data: string | null): number => {
  if (data != null) {
    return data.length;
  }
  return 0;
};

// Test Case 3: Function with branches
export const classify = (score: number): string => {
  if (score >= 90) {
    return 'A';
  } else if (score >= 80) {
    return 'B';
  } else if (score >= 70) {
    return 'C';
  } else {
    return 'D';
  }
};

// Test Case 4: Function with loop
export const sumArray = (arr: number[]): number => {
  let sum = 0;
  for (const num of arr) {
    sum += num;
  }
  return sum;
};

// Test Case 5: Function with try-catch
export const safeParse = (json: string): any => {
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
};

// Test Case 6: Async function
export const fetchData = async (url: string): Promise<any> => {
  const response = await fetch(url);
  return response.json();
};

// Test Case 7: Taint source simulation
export const processUserInput = (input: string): string => {
  return input.replace(/[<>]/g, '');
};

// Test Case 8: Function with multiple return paths
export const divide = (a: number, b: number): number | null => {
  if (b === 0) {
    return null;
  }
  return a / b;
};
