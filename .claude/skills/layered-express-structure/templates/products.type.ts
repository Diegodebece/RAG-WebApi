export interface Product {
    id: number;
    name: string;
    description: string | null;
    price: number;
    status: "active" | "inactive";
    categoryId: number;
}
