import { Sema } from "async-sema";
const settleAll = async (items, fn, maxConcurrent) => {
  let err, cb;
  if (maxConcurrent) {
    const sema = new Sema(maxConcurrent);
    cb = async (item) => {
      await sema.acquire();
      try {
        return await fn(item);
      } finally {
        sema.release();
      }
    };
  } else {
    cb = fn;
  }
  await Promise.all(
    items.map(async (i) => {
      try {
        await cb(i);
      } catch (error) {
        err = error;
      }
    })
  );
  if (err)
    throw err;
};
export {
  settleAll
};
