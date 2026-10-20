import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddSessionDto } from '../../../../src/api/tasks/dto/add-session.dto';
import { CancelDto } from '../../../../src/api/tasks/dto/cancel.dto';
import { AnswerDto } from '../../../../src/api/tasks/dto/answer.dto';
import { PromptDto } from '../../../../src/api/tasks/dto/prompt.dto';
import { SinceQueryDto } from '../../../../src/api/tasks/dto/since-query.dto';
import { StartTaskDto } from '../../../../src/api/tasks/dto/start-task.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  return (await validate(plainToInstance(cls, plain))).map((e) => e.property);
}

describe('StartTaskDto', () => {
  it('accepts a title and a repository name', async () => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', title: 'Fix it', repository: 'docs' })).toEqual([]);
  });

  it.each(['', '   ', 5, 'x'.repeat(201)])('rejects title %p', async (title) => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', title })).toContain('title');
  });

  it.each(['', 5, 'a b', 'x'.repeat(101)])('rejects repository %p', async (repository) => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', repository })).toContain('repository');
  });

  it('rejects repository together with repoUrl', async () => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', repository: 'docs', repoUrl: 'https://github.com/o/r' })).toContain('repository');
  });

  it('accepts a prompt alone', async () => {
    expect(await errorsOf(StartTaskDto, { prompt: 'do it' })).toEqual([]);
  });

  it('accepts https repo, ref and model', async () => {
    const plain = { prompt: 'p', repoUrl: 'https://github.com/o/r.git', repoRef: 'feature/x-1.2', model: 'claude-sonnet-4-5' };
    expect(await errorsOf(StartTaskDto, plain)).toEqual([]);
  });

  it.each(['', '   ', 5, undefined, 'x'.repeat(20001)])('rejects prompt %p', async (prompt) => {
    expect(await errorsOf(StartTaskDto, { prompt })).toContain('prompt');
  });

  it.each([
    'http://github.com/o/r',
    'file:///etc/passwd',
    'ssh://git@github.com/o/r',
    'git@github.com:o/r.git',
    'https://user:pw@github.com/o/r',
    'https://user@github.com/o/r',
    'https://',
    'not a url',
    '',
  ])('rejects repoUrl %p', async (repoUrl) => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', repoUrl })).toContain('repoUrl');
  });

  it.each(['-x', 'a b', 'a;rm', '', 'a$(x)', 'x'.repeat(201)])('rejects repoRef %p', async (repoRef) => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', repoRef })).toContain('repoRef');
  });

  it.each(['a b', 'm;x', '', 'x'.repeat(101)])('rejects model %p', async (model) => {
    expect(await errorsOf(StartTaskDto, { prompt: 'p', model })).toContain('model');
  });
});

describe('PromptDto', () => {
  it('needs non-empty text', async () => {
    expect(await errorsOf(PromptDto, { text: 'hi' })).toEqual([]);
    expect(await errorsOf(PromptDto, { text: ' ' })).toContain('text');
    expect(await errorsOf(PromptDto, {})).toContain('text');
  });
});

describe('AnswerDto', () => {
  it('needs text, question is optional string', async () => {
    expect(await errorsOf(AnswerDto, { text: 'yes' })).toEqual([]);
    expect(await errorsOf(AnswerDto, { text: 'yes', question: 'q-1' })).toEqual([]);
    expect(await errorsOf(AnswerDto, { text: '' })).toContain('text');
    expect(await errorsOf(AnswerDto, { text: 'y', question: 3 })).toContain('question');
  });
});

describe('SinceQueryDto', () => {
  it('accepts absent and non-negative integers (as strings)', async () => {
    expect(await errorsOf(SinceQueryDto, {})).toEqual([]);
    expect(await errorsOf(SinceQueryDto, { since: '0' })).toEqual([]);
    expect(await errorsOf(SinceQueryDto, { since: '12' })).toEqual([]);
  });
  it.each(['-1', '1.5', 'abc', ''])('rejects %p', async (since) => {
    expect(await errorsOf(SinceQueryDto, { since })).toContain('since');
  });
});

describe('session fields', () => {
  it.each(['main', 'a', 'second-1', 'a_b', '0x', 'a'.repeat(32)])('accepts the name %p', async (name) => {
    expect(await errorsOf(AddSessionDto, { name })).toEqual([]);
    expect(await errorsOf(PromptDto, { text: 't', session: name })).toEqual([]);
    expect(await errorsOf(CancelDto, { session: name })).toEqual([]);
  });

  it.each(['', 'Upper', '-a', '_a', 'a b', 'a.b', 'a'.repeat(33), 5])('rejects the name %p', async (name) => {
    expect(await errorsOf(AddSessionDto, { name })).toContain('name');
    expect(await errorsOf(AddSessionDto, { name: 'ok', forkFrom: name })).toContain('forkFrom');
    expect(await errorsOf(PromptDto, { text: 't', session: name })).toContain('session');
    expect(await errorsOf(AnswerDto, { text: 't', session: name })).toContain('session');
    expect(await errorsOf(SinceQueryDto, { session: name })).toContain('session');
  });

  it('requires a name and validates model and prompt like the new-task form', async () => {
    expect(await errorsOf(AddSessionDto, {})).toContain('name');
    expect(await errorsOf(AddSessionDto, { name: 'a', model: 'claude-sonnet-4-5', forkFrom: 'main', prompt: 'go' })).toEqual([]);
    expect(await errorsOf(AddSessionDto, { name: 'a', model: 'a b' })).toContain('model');
    expect(await errorsOf(AddSessionDto, { name: 'a', prompt: '  ' })).toContain('prompt');
    expect(await errorsOf(AddSessionDto, { name: 'a', prompt: 'x'.repeat(20001) })).toContain('prompt');
  });

  it('keeps the session optional', async () => {
    expect(await errorsOf(CancelDto, {})).toEqual([]);
    expect(await errorsOf(SinceQueryDto, {})).toEqual([]);
  });
});
