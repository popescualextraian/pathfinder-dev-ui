import { Injectable } from '@nestjs/common';

/** Serializes work on one schedule (firing, result capture, edits, delete), so no change of its file is lost. */
@Injectable()
export class ScheduleLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const tail = result.catch(() => undefined);
    this.tails.set(id, tail);
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return result;
  }
}
