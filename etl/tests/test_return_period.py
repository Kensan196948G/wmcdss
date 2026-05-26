from etl.common.return_period import gumbel_fit, return_level, return_levels


def test_fit_yields_positive_beta():
    vals = [22.1, 19.4, 25.0, 21.5, 23.6, 28.7, 20.1, 24.5, 26.0, 22.9]
    mu, beta = gumbel_fit(vals)
    assert beta > 0
    assert mu > 10


def test_50y_exceeds_observed_max():
    vals = [22.1, 19.4, 25.0, 21.5, 23.6, 28.7, 20.1, 24.5, 26.0, 22.9]
    res = return_levels(vals)
    assert res[50] > max(vals)
    assert res[100] > res[50] > res[10] > res[2]


def test_minimum_sample_size():
    try:
        gumbel_fit([1, 2, 3])
    except ValueError:
        return
    raise AssertionError("should reject tiny samples")
