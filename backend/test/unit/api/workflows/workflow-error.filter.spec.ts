import { HttpStatus } from '@nestjs/common';
import { describeWorkflowError, WorkflowErrorFilter } from '../../../../src/api/workflows/workflow-error.filter';
import { WorkflowConflictError, WorkflowDefinitionError, WorkflowInvalidError, WorkflowNotFoundError, WorkflowReadOnlyError } from '../../../../src/workflow';

describe('WorkflowErrorFilter', () => {
  it('maps not found to 404, conflict to 409 and invalid to 400 with the error message', () => {
    expect(describeWorkflowError(new WorkflowNotFoundError('Workflow x not found'))).toEqual({ statusCode: HttpStatus.NOT_FOUND, message: 'Workflow x not found' });
    expect(describeWorkflowError(new WorkflowConflictError('busy'))).toEqual({ statusCode: HttpStatus.CONFLICT, message: 'busy' });
    expect(describeWorkflowError(new WorkflowInvalidError('bad'))).toEqual({ statusCode: HttpStatus.BAD_REQUEST, message: 'bad' });
  });

  it('maps a read-only folder to 403 and a refused definition to 400 with its location', () => {
    expect(describeWorkflowError(new WorkflowReadOnlyError())).toEqual({ statusCode: HttpStatus.FORBIDDEN, message: 'The workflow folder is read-only' });
    const location = { stepId: 'a', session: 'x', field: 'fork' };
    expect(describeWorkflowError(new WorkflowDefinitionError('bad fork', location))).toEqual({ statusCode: 400, message: 'bad fork', location });
  });

  it('writes the location of a definition error into the body', () => {
    const json = jest.fn();
    const host = { switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/workflows' }), getResponse: () => ({ status: () => ({ json }) }) }) };
    new WorkflowErrorFilter().catch(new WorkflowDefinitionError('bad', { field: 'title' }), host as never);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'bad', location: { field: 'title' }, path: '/api/workflows' });
  });

  it('writes the JSON error body with the path', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/workflow-runs/R-1/stop' }), getResponse: () => ({ status }) }),
    };
    new WorkflowErrorFilter().catch(new WorkflowConflictError('The run is already done'), host as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ statusCode: 409, message: 'The run is already done', path: '/api/workflow-runs/R-1/stop' });
  });
});
