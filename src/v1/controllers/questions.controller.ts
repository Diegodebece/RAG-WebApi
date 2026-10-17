import type { Request, Response, NextFunction } from "express";
import { askQuestionService } from "../services/questions.service.js";
import { requireUserId } from "../utils/requireUserId.util.js";
import type { AskQuestionInput } from "../validators/questions.validator.js";

// The answer comes within the request, after the question's turn with the model. If the browser disconnects
// before the response is sent, the signal tells the service to drop the question.
export const askQuestion = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
        const cancelled = new AbortController();
        res.on("close", () => {
            if (!res.writableFinished) {
                cancelled.abort();
            }
        });

        const { id } = req.params;
        const answer = await askQuestionService(requireUserId(req), id, req.validatedBody as AskQuestionInput, cancelled.signal);
        return res.status(200).json({ success: true, message: "Question answered successfully", data: answer });
    } catch (error) {
        next(error);
    }
};
