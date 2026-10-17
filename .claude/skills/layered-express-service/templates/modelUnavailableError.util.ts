import { AppError } from "./appError.util.js";

// The model server cannot be reached (Ollama is not running yet, or stopped). A request waiting for an
// answer gets the usual 503; background work recognizes it by its type and tries again later, without
// depending on which status code it carries.
export class ModelUnavailableError extends AppError {
    constructor() {
        super(503, "The model server is not available");
        this.name = "ModelUnavailableError";
    }
}
