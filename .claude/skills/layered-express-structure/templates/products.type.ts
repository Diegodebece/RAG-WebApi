export interface Product {
    id: string;
    name: string;
    description: string | null;
    price: number;
    status: "active" | "inactive";
    categoryId: string;
}
