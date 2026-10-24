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

const STANDARD_COUNTABLE_RATIOS: Record<string, number> = {
  piece: 1,
  pcs: 1,
  pc: 1,
};

/**
 * Validates whether two units can be converted using either product-specific conversion
 * or standard physical metric equivalents (e.g. kg <-> g, litre <-> ml, piece <-> pcs).
 *
 * @param fromUnit Unit of the incoming quantity
 * @param toUnit Unit to convert to
 * @param productConversion The product's configured unit conversion (e.g. 1 carton = 24 bottles/pieces, 1 piece = 350g)
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

  // 1. Standard Countable/Discrete Units (piece <-> pcs <-> pc)
  if (STANDARD_COUNTABLE_RATIOS[fromUnit] && STANDARD_COUNTABLE_RATIOS[toUnit]) {
    return STANDARD_COUNTABLE_RATIOS[fromUnit] / STANDARD_COUNTABLE_RATIOS[toUnit];
  }

  // 2. Standard Metric Weight Conversions (kg <-> g)
  if (STANDARD_WEIGHT_RATIOS[fromUnit] && STANDARD_WEIGHT_RATIOS[toUnit]) {
    return STANDARD_WEIGHT_RATIOS[fromUnit] / STANDARD_WEIGHT_RATIOS[toUnit];
  }

  // 3. Standard Metric Volume Conversions (litre <-> ml)
  if (STANDARD_VOLUME_RATIOS[fromUnit] && STANDARD_VOLUME_RATIOS[toUnit]) {
    return STANDARD_VOLUME_RATIOS[fromUnit] / STANDARD_VOLUME_RATIOS[toUnit];
  }

  // 4. Check Product-Specific Conversion rule
  if (productConversion && productConversion.multiplier > 0) {
    const { baseUnit, sellUnit, multiplier } = productConversion;

    // 4a. Direct match between sellUnit (e.g. carton/packet) and baseUnit (e.g. piece/g)
    if (fromUnit === sellUnit && toUnit === baseUnit) {
      return multiplier;
    }
    if (fromUnit === baseUnit && toUnit === sellUnit) {
      return 1 / multiplier;
    }

    // 4b. Match with countable discrete synonyms (e.g. sellUnit="piece" and fromUnit="pcs")
    const isFromSell =
      fromUnit === sellUnit ||
      Boolean(STANDARD_COUNTABLE_RATIOS[fromUnit] && STANDARD_COUNTABLE_RATIOS[sellUnit]);
    const isToBase =
      toUnit === baseUnit ||
      Boolean(STANDARD_COUNTABLE_RATIOS[toUnit] && STANDARD_COUNTABLE_RATIOS[baseUnit]);

    if (isFromSell && isToBase) {
      return multiplier;
    }

    const isFromBase =
      fromUnit === baseUnit ||
      Boolean(STANDARD_COUNTABLE_RATIOS[fromUnit] && STANDARD_COUNTABLE_RATIOS[baseUnit]);
    const isToSell =
      toUnit === sellUnit ||
      Boolean(STANDARD_COUNTABLE_RATIOS[toUnit] && STANDARD_COUNTABLE_RATIOS[sellUnit]);

    if (isFromBase && isToSell) {
      return 1 / multiplier;
    }

    // 4c. Dimension-bridged conversion via baseUnit using standard metric ratios
    // e.g., product has baseUnit="g", sellUnit="piece" (multiplier=350).
    // Converting from "kg" to "piece":
    // "kg" -> "g" (via STANDARD_WEIGHT_RATIOS, x1000) -> "piece" (via multiplier, /350)
    if (isToSell) {
      // fromUnit -> baseUnit -> sellUnit
      if (STANDARD_WEIGHT_RATIOS[fromUnit] && STANDARD_WEIGHT_RATIOS[baseUnit]) {
        const toBaseFactor = STANDARD_WEIGHT_RATIOS[fromUnit] / STANDARD_WEIGHT_RATIOS[baseUnit];
        return toBaseFactor * (1 / multiplier);
      }
      if (STANDARD_VOLUME_RATIOS[fromUnit] && STANDARD_VOLUME_RATIOS[baseUnit]) {
        const toBaseFactor = STANDARD_VOLUME_RATIOS[fromUnit] / STANDARD_VOLUME_RATIOS[baseUnit];
        return toBaseFactor * (1 / multiplier);
      }
    }

    if (isFromSell) {
      // sellUnit -> baseUnit -> toUnit
      if (STANDARD_WEIGHT_RATIOS[baseUnit] && STANDARD_WEIGHT_RATIOS[toUnit]) {
        const fromBaseFactor = STANDARD_WEIGHT_RATIOS[baseUnit] / STANDARD_WEIGHT_RATIOS[toUnit];
        return multiplier * fromBaseFactor;
      }
      if (STANDARD_VOLUME_RATIOS[baseUnit] && STANDARD_VOLUME_RATIOS[toUnit]) {
        const fromBaseFactor = STANDARD_VOLUME_RATIOS[baseUnit] / STANDARD_VOLUME_RATIOS[toUnit];
        return multiplier * fromBaseFactor;
      }
    }
  }

  throw new AppError(
    `Cannot convert between incompatible units: '${fromUnit}' and '${toUnit}'. No valid product conversion configured.`,
    400,
    "INVALID_UNIT_CONVERSION"
  );
};

/**
 * Checks if a unit conversion between fromUnit and toUnit is valid.
 */
export const canConvert = (
  fromUnit: string,
  toUnit: string,
  productConversion?: ProductUnitConversion
): boolean => {
  try {
    getConversionFactor(fromUnit as UnitOfMeasure, toUnit as UnitOfMeasure, productConversion);
    return true;
  } catch {
    return false;
  }
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
