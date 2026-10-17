export class AppError extends Error {
    status: number;
    details?: string[];

    constructor(status: number, message: string, details?: string[]) {
        super(message);
        this.name = "AppError";
        this.status = status;
        if (details) {
            this.details = details;
        }
    }
}
