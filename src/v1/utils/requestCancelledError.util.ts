import { AppError } from "./appError.util.js";

// The browser closed the connection while its request waited for the model or while the model was answering.
// Nobody receives this response; the error only stops the work (the question leaves the line, Ollama stops).
export class RequestCancelledError extends AppError {
    constructor() {
        super(503, "The request was cancelled");
        this.name = "RequestCancelledError";
    }
}
