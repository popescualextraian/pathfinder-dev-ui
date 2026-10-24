import { ArchitectureErrorFilter } from '../../../../src/api/architecture/architecture-error.filter';
import { ArchitectureBadRequestError, ArchitectureNotFoundError } from '../../../../src/service/architecture/architecture-errors';
import { ArchitectureFileError } from '../../../../src/service/architecture/architecture-validator';
import { RepositoryFileTooLargeError, RepositoryUnavailableError } from '../../../../src/service/architecture/repository-files';

function run(error: Error) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/architecture' }), getResponse: () => ({ status }) }) };
  new ArchitectureErrorFilter().catch(error as never, host as never);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('ArchitectureErrorFilter', () => {
  it('maps not found to 404 and bad requests to 400', () => {
    expect(run(new ArchitectureNotFoundError('nope'))).toEqual({ status: 404, body: { statusCode: 404, message: 'nope', path: '/api/architecture' } });
    expect(run(new ArchitectureBadRequestError('bad')).status).toBe(400);
  });

  it('maps a bad file to 422 with the file', () => {
    const { status, body } = run(new ArchitectureFileError('docs/architecture/model.json', 'parts: must be an array'));
    expect(status).toBe(422);
    expect(body).toMatchObject({ statusCode: 422, file: 'docs/architecture/model.json', message: 'docs/architecture/model.json: parts: must be an array' });
  });

  it('maps a too large file to 422 with its path', () => {
    const { status, body } = run(new RepositoryFileTooLargeError('docs/architecture/model.json', 10));
    expect(status).toBe(422);
    expect(body.file).toBe('docs/architecture/model.json');
  });

  it('maps an unavailable repository to 502', () => {
    expect(run(new RepositoryUnavailableError('could not read repository x')).status).toBe(502);
  });
});
