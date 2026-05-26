"""Gumbel-based return-period estimation for annual maxima.

Used for the 50-year-design-wave / design-wind analysis.

Formula (Gumbel)
----------------
    F(x) = exp(-exp(-(x - mu) / beta))
    Estimates: mu_hat = mean(x) - 0.5772 * beta_hat
               beta_hat = sqrt(6) * std(x) / pi
    Return value for return period T:
               x_T = mu_hat - beta_hat * ln(-ln(1 - 1/T))
"""
from __future__ import annotations
import math
from collections.abc import Sequence


def gumbel_fit(values: Sequence[float]) -> tuple[float, float]:
    """Return (mu_hat, beta_hat) from method-of-moments."""
    vals = [float(v) for v in values if v is not None and not math.isnan(v)]
    if len(vals) < 5:
        raise ValueError("need at least 5 annual maxima for a meaningful fit")
    n = len(vals)
    mean = sum(vals) / n
    var = sum((v - mean) ** 2 for v in vals) / (n - 1)
    std = math.sqrt(var)
    beta = math.sqrt(6.0) * std / math.pi
    mu = mean - 0.5772 * beta
    return mu, beta


def return_level(mu: float, beta: float, T: float) -> float:
    """x_T from Gumbel parameters; T in years."""
    if T <= 1:
        raise ValueError("return period T must be > 1")
    return mu - beta * math.log(-math.log(1 - 1 / T))


def return_levels(values: Sequence[float], periods: Sequence[float] = (2, 5, 10, 25, 50, 100)) -> dict[float, float]:
    mu, beta = gumbel_fit(values)
    return {float(T): return_level(mu, beta, T) for T in periods}
