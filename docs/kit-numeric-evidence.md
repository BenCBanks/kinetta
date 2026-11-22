# Numeric facts in Kit answers

Kit's numeric guarantee is limited: every digit in its verdict and reason comes from a validated current-turn fact and is rendered by the app. The app adds the fact's own formatted value and noun/aggregation label (for example, 80 g protein per logged day). It rejects digits outside placeholders and malformed or mismatched references.

The app normalizes text with NFKC and removes Unicode format and combining marks before validation. A placeholder may touch only approved whitespace, punctuation or connective words; the app supplies its units and label. It does not verify sentence meaning or police number words. A fluent answer can still make a misleading claim around a correctly labelled value, so this validation is not a model-quality evaluation. The maintainer's reviewed live evaluation remains a separate release requirement.
