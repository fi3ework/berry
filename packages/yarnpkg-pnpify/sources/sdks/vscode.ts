import {PortablePath, npath, ppath, xfs}                      from '@yarnpkg/fslib';
import {PnpApi}                                               from '@yarnpkg/pnp';
import CJSON                                                  from 'comment-json';
import mergeWith                                              from 'lodash/mergeWith';

import {Wrapper, GenerateIntegrationWrapper, IntegrationSdks} from '../generateSdk';

export const merge = (object: unknown, source: unknown) =>
  mergeWith(object, source, (objValue, srcValue) => {
    if (Array.isArray(objValue))
      return [...new Set(objValue.concat(srcValue))];

    return undefined;
  });

export enum VSCodeConfiguration {
  settings = `settings.json`,
  extensions = `extensions.json`,
}

export const addVSCodeWorkspaceConfiguration = async (pnpApi: PnpApi, type: VSCodeConfiguration, patch: any) => {
  const topLevelInformation = pnpApi.getPackageInformation(pnpApi.topLevel)!;
  const projectRoot = npath.toPortablePath(topLevelInformation.packageLocation);

  const filePath = ppath.join(projectRoot, `.vscode` as PortablePath, type as PortablePath);

  const content = await xfs.existsPromise(filePath)
    ? await xfs.readFilePromise(filePath, `utf8`)
    : `{}`;

  const data = CJSON.parse(content);
  const patched = `${CJSON.stringify(merge(data, patch), null, 2)}\n`;

  await xfs.mkdirpPromise(ppath.dirname(filePath));
  await xfs.changeFilePromise(filePath, patched, {
    automaticNewlines: true,
  });
};


export const generateEslintWrapper: GenerateIntegrationWrapper = async (pnpApi: PnpApi, target: PortablePath, wrapper: Wrapper) => {
  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.settings, {
    [`eslint.nodePath`]: npath.fromPortablePath(
      ppath.dirname(ppath.dirname(ppath.dirname(
        wrapper.getProjectPathTo(
          `lib/api.js` as PortablePath,
        ),
      ))),
    ),
  });

  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.extensions, {
    [`recommendations`]: [
      `dbaeumer.vscode-eslint`,
    ],
  });
};

export const generatePrettierWrapper: GenerateIntegrationWrapper = async (pnpApi: PnpApi, target: PortablePath, wrapper: Wrapper) => {
  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.settings, {
    [`prettier.prettierPath`]: npath.fromPortablePath(
      wrapper.getProjectPathTo(
        `index.js` as PortablePath,
      ),
    ),
  });

  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.extensions, {
    [`recommendations`]: [
      `esbenp.prettier-vscode`,
    ],
  });
};

export const generateTypescriptWrapper: GenerateIntegrationWrapper = async (pnpApi: PnpApi, target: PortablePath, wrapper: Wrapper) => {
  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.settings, {
    [`typescript.tsdk`]: npath.fromPortablePath(
      ppath.dirname(
        wrapper.getProjectPathTo(
          `lib/tsserver.js` as PortablePath,
        ),
      ),
    ),
    [`typescript.enablePromptUseWorkspaceTsdk`]: true,
  });

  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.extensions, {
    [`recommendations`]: [
      `arcanis.vscode-zipfs`,
    ],
  });
};

export const generateStylelintWrapper: GenerateIntegrationWrapper = async (pnpApi: PnpApi, target: PortablePath, wrapper: Wrapper) => {
  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.settings, {
    [`stylelint.stylelintPath`]: npath.fromPortablePath(
      wrapper.getProjectPathTo(
        `lib/index.js` as PortablePath,
      ),
    ),
  });

  await addVSCodeWorkspaceConfiguration(pnpApi, VSCodeConfiguration.extensions, {
    [`recommendations`]: [
      `stylelint.vscode-stylelint`,
    ],
  });
};

export const VSCODE_SDKS: IntegrationSdks = [
  [`eslint`, generateEslintWrapper],
  [`prettier`, generatePrettierWrapper],
  [`typescript-language-server`, null],
  [`typescript`, generateTypescriptWrapper],
  [`stylelint`, generateStylelintWrapper],
];
