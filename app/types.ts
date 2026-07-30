export interface Product {
  id: string;
  name: string;      // English translated name
  nameUrdu: string;  // Original Urdu name
  price: number;
  category: string;
  code?: string;     // Short code or index number from sheet
}

export interface Category {
  id: string;
  name: string;
  nameUrdu: string;
}
