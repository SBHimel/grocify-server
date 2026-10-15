import { UnitOfMeasure, ProductUnitConversion } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";

/**
 * Standard conversion factors relative to standard base units:
 * - Weight: base unit "g" (1 kg = 1000 g)
 * - Volume: base unit "ml" (1 litre = 1000 ml)
 * - Discrete: base unit "piece"
 */
const STANDARD_WEIGHT_RATIOS: Record<string, number> = {
  g: 1,
  kg: 1000,
};

const STANDARD_VOLUME_RATIOS: Record<string, number> = {
  ml: 1,
  litre: 1000,
};

/**
 * Validates whether two units can be converted using either product-specific conversion
 * or standard physical metric equivalents (e.g. kg <-> g, litre <-> ml).
 *
 * @param fromUnit Unit of the incoming quantity
 * @param toUnit Unit to convert to
 * @param productConversion The product's configured unit conversion (e.g. 1 carton = 24 bottles/pieces)
 * @returns The multiplier such that `quantityInFromUnit * factor = quantityInToUnit`
 */
export const getConversionFactor = (
  fromUnit: UnitOfMeasure,
  toUnit: UnitOfMeasure,
  productConversion?: ProductUnitConversion
): number => {
  if (fromUnit === toUnit) {
    return 1;
  }

  // 1. Check Product-Specific Conversion rule
  if (productConversion && productConversion.multiplier > 0) {
    const { baseUnit, sellUnit, multiplier } = productConversion;

    // From sellUnit (e.g. carton/packet) to baseUnit (e.g. piece/g)
    if (fromUnit === sellUnit && toUnit === baseUnit) {
      return multiplier;
    }

    // From baseUnit to sellUnit
    if (fromUnit === baseUnit && toUnit === sellUnit) {
      return 1 / multiplier;
    }
  }

  // 2. Standard Metric Weight Conversions (kg <-> g)
  if (STANDARD_WEIGHT_RATIOS[fromUnit] && STANDARD_WEIGHT_RATIOS[toUnit]) {
    return STANDARD_WEIGHT_RATIOS[fromUnit] / STANDARD_WEIGHT_RATIOS[toUnit];
  }

  // 3. Standard Metric Volume Conversions (litre <-> ml)
  if (STANDARD_VOLUME_RATIOS[fromUnit] && STANDARD_VOLUME_RATIOS[toUnit]) {
    return STANDARD_VOLUME_RATIOS[fromUnit] / STANDARD_VOLUME_RATIOS[toUnit];
  }

  throw new AppError(
    `Cannot convert between incompatible units: '${fromUnit}' and '${toUnit}'. No valid product conversion configured.`,
    400,
    "INVALID_UNIT_CONVERSION"
  );
};

/**
 * Converts a quantity from one unit to another.
 * Prevents negative or NaN quantities.
 */
export const convertQuantity = (
  quantity: number,
  fromUnit: UnitOfMeasure,
  toUnit: UnitOfMeasure,
  productConversion?: ProductUnitConversion
): number => {
  if (typeof quantity !== "number" || isNaN(quantity) || quantity < 0) {
    throw new AppError(
      "Quantity must be a non-negative number.",
      400,
      "INVALID_QUANTITY"
    );
  }

  const factor = getConversionFactor(fromUnit, toUnit, productConversion);
  const converted = quantity * factor;

  // Round to 4 decimal places to prevent floating point drift
  return Math.round(converted * 10000) / 10000;
};
