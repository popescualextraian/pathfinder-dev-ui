import { HttpStatus } from '@nestjs/common';
import { describeWorkflowError, WorkflowErrorFilter } from '../../../../src/api/workflows/workflow-error.filter';
import { WorkflowConflictError, WorkflowInvalidError, WorkflowNotFoundError } from '../../../../src/workflow';

describe('WorkflowErrorFilter', () => {
  it('maps not found to 404, conflict to 409 and invalid to 400 with the error message', () => {
    expect(describeWorkflowError(new WorkflowNotFoundError('Workflow x not found'))).toEqual({ statusCode: HttpStatus.NOT_FOUND, message: 'Workflow x not found' });
    expect(describeWorkflowError(new WorkflowConflictError('busy'))).toEqual({ statusCode: HttpStatus.CONFLICT, message: 'busy' });
    expect(describeWorkflowError(new WorkflowInvalidError('bad'))).toEqual({ statusCode: HttpStatus.BAD_REQUEST, message: 'bad' });
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
